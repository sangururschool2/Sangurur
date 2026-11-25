import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import {
  Cohort,
  Learner,
  Curriculum,
  DailyRegister,
  TeacherFeedback,
  AuditLog,
  SchoolSetting,
  AttendanceStatus,
  CorrectionRecord,
  Teacher,
  WeeklyTimetableEntry,
  TimetableTopicSlot,
  CohortLevel,
  CohortClass,
  CourseOffered,
} from '../types';
import {
  PREDEFINED_CURRICULA,
  UPPER_JUNIOR_SENIOR_CURRICULUM_ID,
} from './curriculumTemplates';

export { UPPER_JUNIOR_SENIOR_CURRICULUM_ID };

/**
 * Recursively removes keys with `undefined` values before passing objects to
 * Firestore `setDoc` / `updateDoc`, while preserving `null`, primitives, Dates,
 * and Firestore FieldValue sentinels.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        result[k] = stripUndefinedDeep(v);
      }
    }
    return result as T;
  }
  return value;
}

// ----------------- TEACHERS -----------------
export async function getTeachers(): Promise<Teacher[]> {
  try {
    const snap = await getDocs(collection(db, 'teachers'));
    return snap.docs.map((d) => ({ ...d.data(), uid: d.id } as Teacher));
  } catch (error) {
    console.warn('Could not load teachers list:', error);
    return [];
  }
}

// Exact legacy starter/demo document IDs previously seeded on initial setup
const LEGACY_DEMO_COHORT_IDS = new Set([
  'coh_1794493904667_72u8',
  'coh_1794493904967_p7ke',
]);
const LEGACY_DEMO_LEARNER_IDS = new Set([
  'learner_1794493810016_x4aq8',
]);
const LEGACY_DEMO_REGISTER_IDS = new Set([
  'reg_GR7-COMP-2026_learner_1794493810016_x4aq8_2026-11-12',
]);

export async function purgeLegacyDemoRecordsIfAdmin(): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  try {
    await Promise.allSettled([
      ...Array.from(LEGACY_DEMO_COHORT_IDS).map((id) => deleteDoc(doc(db, 'cohorts', id))),
      ...Array.from(LEGACY_DEMO_LEARNER_IDS).map((id) => deleteDoc(doc(db, 'learners', id))),
      ...Array.from(LEGACY_DEMO_REGISTER_IDS).map((id) => deleteDoc(doc(db, 'dailyRegisters', id))),
    ]);
  } catch {
    // Non-admin staff accounts silently skip deletion; read filters still exclude them.
  }
}

// ----------------- COHORTS -----------------
export async function getCohorts(
  teacherUid?: string,
  hasSchoolWideAccess: boolean = true
): Promise<Cohort[]> {
  try {
    const q =
      !hasSchoolWideAccess && teacherUid
        ? query(collection(db, 'cohorts'), where('teacherId', '==', teacherUid))
        : query(collection(db, 'cohorts'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs
      .filter((d) => !LEGACY_DEMO_COHORT_IDS.has(d.id))
      .map((d) => ({ ...d.data(), id: d.id } as Cohort))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'cohorts');
    return [];
  }
}

export async function createCohort(cohortData: Omit<Cohort, 'id' | 'createdAt'>): Promise<Cohort> {
  const docId = `coh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const newCohort = stripUndefinedDeep<Cohort>({
    ...cohortData,
    id: docId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await setDoc(doc(db, 'cohorts', docId), newCohort);
    return newCohort;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `cohorts/${docId}`);
    throw error;
  }
}

export async function updateCohort(cohortId: string, updates: Partial<Cohort>): Promise<void> {
  try {
    const ref = doc(db, 'cohorts', cohortId);
    await updateDoc(
      ref,
      stripUndefinedDeep({
        ...updates,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `cohorts/${cohortId}`);
    throw error;
  }
}

export async function deleteCohort(
  cohortId: string,
  actor?: { uid: string; fullName: string; role: string }
): Promise<void> {
  try {
    const cohortSnap = await getDoc(doc(db, 'cohorts', cohortId));
    const cohortName = cohortSnap.exists() ? String(cohortSnap.data().name || cohortId) : cohortId;

    // 1. Delete dependent child documents BEFORE deleting the parent cohort document
    // so Firestore security rules evaluating ownsCohort(cohortId) succeed for every child.
    const [classesSnap, levelsSnap, timetablesSnap, membersSnap, learnersSnap] = await Promise.all([
      getDocs(query(collection(db, 'cohortClasses'), where('cohortId', '==', cohortId))),
      getDocs(query(collection(db, 'cohortLevels'), where('cohortId', '==', cohortId))),
      getDocs(query(collection(db, 'weeklyTimetables'), where('cohortId', '==', cohortId))),
      getDocs(query(collection(db, 'cohortMembers'), where('cohortId', '==', cohortId))),
      getDocs(query(collection(db, 'learners'), where('assignedCohortIds', 'array-contains', cohortId))),
    ]);

    const deletedClassIds = new Set(classesSnap.docs.map((d) => d.id));
    const deletedLevelIds = new Set(levelsSnap.docs.map((d) => d.id));

    await Promise.all([
      ...classesSnap.docs.map((d) => deleteDoc(d.ref)),
      ...levelsSnap.docs.map((d) => deleteDoc(d.ref)),
      ...timetablesSnap.docs.map((d) => deleteDoc(d.ref)),
      ...membersSnap.docs.map((d) => deleteDoc(d.ref)),
    ]);

    // 2. Unassign cohort, level, and class references from affected learner profiles
    const learnerDocsById = new Map<string, (typeof learnersSnap.docs)[number]>();
    learnersSnap.docs.forEach((d) => learnerDocsById.set(d.id, d));

    const extraMemberLearnerIds = membersSnap.docs
      .map((d) => String(d.data().learnerId || ''))
      .filter((lid) => lid && !learnerDocsById.has(lid));

    for (const lid of extraMemberLearnerIds) {
      const lSnap = await getDoc(doc(db, 'learners', lid));
      if (lSnap.exists()) {
        learnerDocsById.set(lSnap.id, lSnap as (typeof learnersSnap.docs)[number]);
      }
    }

    const now = new Date().toISOString();
    await Promise.all(
      Array.from(learnerDocsById.values()).map((lDoc) => {
        const data = lDoc.data();
        const nextCohortIds = ((data.assignedCohortIds || []) as string[]).filter(
          (cid) => cid !== cohortId
        );
        const nextClassIds = ((data.assignedClassIds || []) as string[]).filter(
          (clsId) => !deletedClassIds.has(clsId)
        );
        const clearsCurrentClass = Boolean(data.classId && deletedClassIds.has(data.classId));
        const clearsCurrentLevel = Boolean(data.levelId && deletedLevelIds.has(data.levelId));

        return updateDoc(lDoc.ref, {
          assignedCohortIds: nextCohortIds,
          assignedClassIds: nextClassIds,
          ...(clearsCurrentClass ? { classId: null, className: null } : {}),
          ...(clearsCurrentLevel ? { levelId: null, levelName: null } : {}),
          updatedAt: now,
        });
      })
    );

    // 3. Delete the parent cohort document
    await deleteDoc(doc(db, 'cohorts', cohortId));

    // 4. Record audit trail
    await logAuditEvent({
      actorId: actor?.uid || auth.currentUser?.uid || 'teacher_staff',
      actorName: actor?.fullName || 'School Staff',
      actorRole: actor?.role || 'teacher',
      action: 'DELETE_COHORT',
      targetEntity: 'cohorts',
      targetId: cohortId,
      details: `Deleted cohort "${cohortName}" along with ${levelsSnap.size} level(s), ${classesSnap.size} class(es), and ${timetablesSnap.size} weekly schedule(s).`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `cohorts/${cohortId}`);
    throw error;
  }
}

export async function getCohortById(cohortId: string): Promise<Cohort | null> {
  try {
    const ref = doc(db, 'cohorts', cohortId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { ...snap.data(), id: snap.id } as Cohort;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `cohorts/${cohortId}`);
    return null;
  }
}

// ----------------- LEARNERS & MEMBERSHIPS -----------------
export async function getLearners(): Promise<Learner[]> {
  try {
    const snap = await getDocs(collection(db, 'learners'));
    return snap.docs
      .filter((d) => !LEGACY_DEMO_LEARNER_IDS.has(d.id))
      .map((d) => ({ ...d.data(), id: d.id } as Learner));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'learners');
    return [];
  }
}

export async function getLearnersByCohort(cohortId: string): Promise<Learner[]> {
  try {
    const memQuery = query(collection(db, 'cohortMembers'), where('cohortId', '==', cohortId));
    const memSnap = await getDocs(memQuery);
    const learnerIds = memSnap.docs.map((d) => d.data().learnerId);

    if (learnerIds.length === 0) return [];

    const learners: Learner[] = [];
    for (const lid of learnerIds) {
      const snap = await getDoc(doc(db, 'learners', lid));
      if (snap.exists()) {
        learners.push({ ...snap.data(), id: snap.id } as Learner);
      }
    }
    return learners;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'cohortMembers');
    return [];
  }
}

// ----------------- COHORT LEVELS & CLASSES -----------------
export function buildDefaultCoursesFromCurriculum(curr?: Curriculum | null): CourseOffered[] {
  if (!curr || !Array.isArray(curr.learningAreas)) return [];
  return curr.learningAreas.map((la, idx) => ({
    id: `course_${la.id || idx + 1}`,
    title: la.title,
    code: `CRS-${String(idx + 1).padStart(2, '0')}`,
    category: curr.category || 'Computing',
    description: la.description || `${curr.title} — ${la.title}`,
    hoursPerWeek: '4 hrs/week',
    curriculumId: curr.id,
  }));
}

export async function getCohortLevels(filters?: {
  cohortId?: string;
  cohortIds?: string[];
}): Promise<CohortLevel[]> {
  try {
    const colRef = collection(db, 'cohortLevels');
    if (filters?.cohortIds && !filters.cohortId) {
      if (filters.cohortIds.length === 0) return [];
      const perCohort = await Promise.all(
        filters.cohortIds.map(async (cid) => {
          const snap = await getDocs(query(colRef, where('cohortId', '==', cid)));
          return snap.docs.map((d) => ({ ...d.data(), id: d.id } as CohortLevel));
        })
      );
      return perCohort
        .flat()
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    const q = filters?.cohortId ? query(colRef, where('cohortId', '==', filters.cohortId)) : colRef;
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id } as CohortLevel))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'cohortLevels');
    return [];
  }
}

export async function createCohortLevel(
  levelData: Omit<CohortLevel, 'id' | 'createdAt'>
): Promise<CohortLevel> {
  const docId = `lvl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const newLevel = stripUndefinedDeep<CohortLevel>({
    ...levelData,
    name: levelData.name.trim().slice(0, 128),
    ...(levelData.code?.trim() ? { code: levelData.code.trim().slice(0, 64) } : {}),
    ...(levelData.description?.trim() ? { description: levelData.description.trim().slice(0, 512) } : {}),
    id: docId,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await setDoc(doc(db, 'cohortLevels', docId), newLevel);
    return newLevel;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `cohortLevels/${docId}`);
    throw error;
  }
}

export async function updateCohortLevel(
  levelId: string,
  updates: Partial<CohortLevel>
): Promise<void> {
  try {
    await updateDoc(
      doc(db, 'cohortLevels', levelId),
      stripUndefinedDeep({
        ...updates,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `cohortLevels/${levelId}`);
    throw error;
  }
}

export async function deleteCohortLevel(levelId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'cohortLevels', levelId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `cohortLevels/${levelId}`);
    throw error;
  }
}

export async function getCohortClasses(filters?: {
  cohortId?: string;
  cohortIds?: string[];
  levelId?: string;
}): Promise<CohortClass[]> {
  try {
    const colRef = collection(db, 'cohortClasses');
    if (filters?.cohortIds && !filters.cohortId) {
      if (filters.cohortIds.length === 0) return [];
      const perCohort = await Promise.all(
        filters.cohortIds.map(async (cid) => {
          const snap = await getDocs(query(colRef, where('cohortId', '==', cid)));
          return snap.docs.map((d) => ({ ...d.data(), id: d.id } as CohortClass));
        })
      );
      return perCohort
        .flat()
        .filter((c) => !filters.levelId || c.levelId === filters.levelId)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    const q = filters?.cohortId
      ? query(colRef, where('cohortId', '==', filters.cohortId))
      : filters?.levelId
      ? query(colRef, where('levelId', '==', filters.levelId))
      : colRef;
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id } as CohortClass))
      .filter((c) => !filters?.levelId || c.levelId === filters.levelId)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'cohortClasses');
    return [];
  }
}

export async function createCohortClass(
  classData: Omit<CohortClass, 'id' | 'createdAt'>
): Promise<CohortClass> {
  const docId = `cls_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const newClass = stripUndefinedDeep<CohortClass>({
    ...classData,
    name: classData.name.trim().slice(0, 128),
    code: classData.code.trim().toUpperCase().slice(0, 64),
    ...(classData.description?.trim() ? { description: classData.description.trim().slice(0, 512) } : {}),
    coursesOffered: Array.isArray(classData.coursesOffered)
      ? classData.coursesOffered.slice(0, 50)
      : [],
    id: docId,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await setDoc(doc(db, 'cohortClasses', docId), newClass);
    return newClass;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `cohortClasses/${docId}`);
    throw error;
  }
}

export async function updateCohortClass(
  classId: string,
  updates: Partial<CohortClass>
): Promise<void> {
  try {
    await updateDoc(
      doc(db, 'cohortClasses', classId),
      stripUndefinedDeep({
        ...updates,
        ...(updates.coursesOffered ? { coursesOffered: updates.coursesOffered.slice(0, 50) } : {}),
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `cohortClasses/${classId}`);
    throw error;
  }
}

export async function deleteCohortClass(classId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'cohortClasses', classId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `cohortClasses/${classId}`);
    throw error;
  }
}

export async function assignLearnerToCohort(
  cohortId: string,
  learner: Learner,
  classContext?: {
    levelId?: string;
    levelName?: string;
    classId?: string;
    className?: string;
    gradeBand?: string;
  }
): Promise<void> {
  try {
    const memberId = `mem_${cohortId}_${learner.id}`;
    await setDoc(
      doc(db, 'cohortMembers', memberId),
      stripUndefinedDeep({
        id: memberId,
        cohortId,
        learnerId: learner.id,
        learnerName: learner.fullName,
        learnerCode: learner.learnerId,
        ...(classContext?.levelId ? { levelId: classContext.levelId, levelName: classContext.levelName } : {}),
        ...(classContext?.classId ? { classId: classContext.classId, className: classContext.className } : {}),
        joinedAt: new Date().toISOString(),
        status: 'active',
      })
    );

    const currentCohorts = learner.assignedCohortIds || [];
    const nextCohorts = currentCohorts.includes(cohortId)
      ? currentCohorts
      : [...currentCohorts, cohortId];
    const currentClasses = learner.assignedClassIds || [];
    const nextClasses =
      classContext?.classId && !currentClasses.includes(classContext.classId)
        ? [...currentClasses, classContext.classId]
        : currentClasses;

    const learnerUpdates: Record<string, unknown> = {
      assignedCohortIds: nextCohorts,
      updatedAt: new Date().toISOString(),
    };
    if (classContext?.classId) {
      learnerUpdates.assignedClassIds = nextClasses;
      learnerUpdates.classId = classContext.classId;
      learnerUpdates.className = classContext.className || null;
      learnerUpdates.levelId = classContext.levelId || null;
      learnerUpdates.levelName = classContext.levelName || null;
    }

    await updateDoc(doc(db, 'learners', learner.id), stripUndefinedDeep(learnerUpdates));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'cohortMembers');
    throw error;
  }
}

export async function removeLearnerFromCohort(cohortId: string, learnerId: string): Promise<void> {
  try {
    const memberId = `mem_${cohortId}_${learnerId}`;
    await deleteDoc(doc(db, 'cohortMembers', memberId));

    const learnerSnap = await getDoc(doc(db, 'learners', learnerId));
    if (learnerSnap.exists()) {
      const data = learnerSnap.data();
      const current = (data.assignedCohortIds || []) as string[];
      await updateDoc(doc(db, 'learners', learnerId), {
        assignedCohortIds: current.filter((c) => c !== cohortId),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `cohortMembers/mem_${cohortId}_${learnerId}`);
    throw error;
  }
}

// ----------------- CURRICULA -----------------
export async function getCurricula(): Promise<Curriculum[]> {
  try {
    const snap = await getDocs(collection(db, 'curricula'));
    if (snap.empty) {
      await seedCurriculaIfEmpty();
      return PREDEFINED_CURRICULA;
    }
    const existingList = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Curriculum));
    const existingIds = new Set(existingList.map((c) => c.id));
    const missingPredefined = PREDEFINED_CURRICULA.filter((c) => !existingIds.has(c.id));

    if (missingPredefined.length > 0) {
      if (auth.currentUser) {
        for (const curr of missingPredefined) {
          try {
            await setDoc(doc(db, 'curricula', curr.id), stripUndefinedDeep(curr));
          } catch {
            // Learners or restricted accounts may not have write access; keep merged in-memory.
          }
        }
      }
      return [...missingPredefined, ...existingList];
    }

    // Ensure the built-in Upper/Junior/Senior template appears early for quick selection
    return existingList.sort((a, b) => {
      if (a.id === UPPER_JUNIOR_SENIOR_CURRICULUM_ID) return -1;
      if (b.id === UPPER_JUNIOR_SENIOR_CURRICULUM_ID) return 1;
      return 0;
    });
  } catch (error) {
    console.warn('Could not read from Firestore curricula collection, falling back to predefined templates:', error);
    return PREDEFINED_CURRICULA;
  }
}

export async function seedCurriculaIfEmpty(): Promise<void> {
  try {
    for (const curr of PREDEFINED_CURRICULA) {
      await setDoc(doc(db, 'curricula', curr.id), stripUndefinedDeep(curr));
    }
  } catch (err) {
    console.warn('Seeding notice:', err);
  }
}

export async function createCurriculum(curr: Omit<Curriculum, 'id' | 'createdAt'>): Promise<Curriculum> {
  const docId = `curr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const newCurr = stripUndefinedDeep<Curriculum>({
    ...curr,
    id: docId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await setDoc(doc(db, 'curricula', docId), newCurr);
    return newCurr;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `curricula/${docId}`);
    throw error;
  }
}

export async function updateCurriculum(id: string, updates: Partial<Curriculum>): Promise<number> {
  try {
    const ref = doc(db, 'curricula', id);
    const snap = await getDoc(ref);
    const currentVersion = snap.exists() ? Number(snap.data().version || 1) : 1;
    const nextVersion = currentVersion + 1;

    await updateDoc(
      ref,
      stripUndefinedDeep({
        ...updates,
        version: nextVersion,
        updatedAt: new Date().toISOString(),
      })
    );
    return nextVersion;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `curricula/${id}`);
    throw error;
  }
}

// ----------------- DAILY REGISTERS & ATTENDANCE -----------------
export async function getDailyRegisters(filters?: {
  cohortId?: string;
  cohortIds?: string[];
  date?: string;
  learnerDocId?: string;
}): Promise<DailyRegister[]> {
  try {
    if (filters?.cohortIds && !filters.cohortId) {
      if (filters.cohortIds.length === 0) {
        return [];
      }
      const perCohort = await Promise.all(
        filters.cohortIds.map(async (cid) => {
          let q = query(collection(db, 'dailyRegisters'), where('cohortId', '==', cid));
          if (filters.date) {
            q = query(q, where('date', '==', filters.date));
          }
          if (filters.learnerDocId) {
            q = query(q, where('learnerDocId', '==', filters.learnerDocId));
          }
          const snap = await getDocs(q);
          return snap.docs
            .filter(
              (d) =>
                !LEGACY_DEMO_REGISTER_IDS.has(d.id) &&
                !LEGACY_DEMO_LEARNER_IDS.has(d.data().learnerDocId)
            )
            .map((d) => ({ ...d.data(), id: d.id } as DailyRegister));
        })
      );
      const deduped = new Map<string, DailyRegister>();
      perCohort.flat().forEach((r) => deduped.set(r.id, r));
      return Array.from(deduped.values()).sort((a, b) =>
        (b.timestamp || '').localeCompare(a.timestamp || '')
      );
    }

    let q = query(collection(db, 'dailyRegisters'));

    if (filters?.cohortId) {
      q = query(q, where('cohortId', '==', filters.cohortId));
    }
    if (filters?.date) {
      q = query(q, where('date', '==', filters.date));
    }
    if (filters?.learnerDocId) {
      q = query(q, where('learnerDocId', '==', filters.learnerDocId));
    }

    const snap = await getDocs(q);
    const results = snap.docs
      .filter(
        (d) =>
          !LEGACY_DEMO_REGISTER_IDS.has(d.id) &&
          !LEGACY_DEMO_LEARNER_IDS.has(d.data().learnerDocId)
      )
      .map((d) => ({ ...d.data(), id: d.id } as DailyRegister));

    return results.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'dailyRegisters');
    return [];
  }
}

export async function verifyDailyRegister(registerId: string, teacherId: string): Promise<void> {
  try {
    const ref = doc(db, 'dailyRegisters', registerId);
    await updateDoc(ref, {
      verificationStatus: 'verified',
      reviewedBy: teacherId,
      reviewedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `dailyRegisters/${registerId}`);
    throw error;
  }
}

export async function correctAttendance(
  register: DailyRegister,
  newStatus: AttendanceStatus,
  reason: string,
  teacherId: string,
  teacherName: string
): Promise<void> {
  try {
    const ref = doc(db, 'dailyRegisters', register.id);
    const correction: CorrectionRecord = {
      correctedBy: teacherId,
      correctedByName: teacherName,
      timestamp: new Date().toISOString(),
      previousStatus: register.status,
      newStatus,
      reason,
    };

    const currentHistory = register.correctionHistory || [];

    await updateDoc(ref, {
      status: newStatus,
      verificationStatus: 'corrected',
      teacherNote: reason,
      reviewedBy: teacherId,
      reviewedAt: new Date().toISOString(),
      correctionHistory: [...currentHistory, correction],
    });

    await logAuditEvent({
      actorId: teacherId,
      actorName: teacherName,
      actorRole: 'teacher',
      action: 'CORRECT_ATTENDANCE',
      targetEntity: 'dailyRegister',
      targetId: register.id,
      details: `Corrected status for ${register.learnerName} on ${register.date} from ${register.status} to ${newStatus}. Reason: ${reason}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `dailyRegisters/${register.id}`);
    throw error;
  }
}

export async function logTeacherAttendanceEntry(entry: {
  cohortId: string;
  cohortCode: string;
  learnerDocId: string;
  learnerId: string;
  learnerName: string;
  date: string;
  status: 'absent' | 'excused';
  teacherId: string;
  teacherName: string;
  reason?: string;
}): Promise<DailyRegister> {
  const docId = `reg_${entry.cohortId}_${entry.learnerDocId}_${entry.date}`;
  const docRef = doc(db, 'dailyRegisters', docId);

  try {
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) {
      throw new Error(
        `An attendance entry for ${entry.learnerName} on ${entry.date} already exists (${existingSnap.data().status}). Use "Correct" to modify it with an audit trail.`
      );
    }

    const register = stripUndefinedDeep<DailyRegister>({
      id: docId,
      cohortId: entry.cohortId,
      cohortCode: entry.cohortCode,
      learnerDocId: entry.learnerDocId,
      learnerId: entry.learnerId,
      learnerName: entry.learnerName,
      date: entry.date,
      timestamp: new Date().toISOString(),
      status: entry.status,
      verificationStatus: 'verified',
      teacherNote: entry.reason || `Marked ${entry.status} by teacher`,
      reviewedBy: entry.teacherId,
      reviewedAt: new Date().toISOString(),
      correctionHistory: [],
    });

    await setDoc(docRef, register);

    await logAuditEvent({
      actorId: entry.teacherId,
      actorName: entry.teacherName,
      actorRole: 'teacher',
      action: 'TEACHER_MARK_ATTENDANCE',
      targetEntity: 'dailyRegister',
      targetId: docId,
      details: `Teacher marked ${entry.learnerName} (${entry.learnerId}) as ${entry.status} for ${entry.date}. Note: ${register.teacherNote}`,
    });

    return register;
  } catch (error: any) {
    if (error?.message?.includes('already exists')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, `dailyRegisters/${docId}`);
    throw error;
  }
}

// ----------------- MASTERY CERTIFICATIONS -----------------
export interface MasteryCertification {
  id: string;
  cohortId: string;
  learnerId: string;
  certified: boolean;
  certifiedBy?: string;
  certifiedByName?: string;
  updatedAt: string;
}

export async function getMasteryCertifications(
  cohortId?: string,
  cohortIds?: string[]
): Promise<MasteryCertification[]> {
  try {
    const colRef = collection(db, 'masteryCertifications');
    if (cohortIds && !cohortId) {
      if (cohortIds.length === 0) return [];
      const perCohort = await Promise.all(
        cohortIds.map(async (cid) => {
          const snap = await getDocs(query(colRef, where('cohortId', '==', cid)));
          return snap.docs.map((d) => ({ ...d.data(), id: d.id } as MasteryCertification));
        })
      );
      return perCohort.flat();
    }
    const q = cohortId ? query(colRef, where('cohortId', '==', cohortId)) : colRef;
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id } as MasteryCertification));
  } catch (error) {
    console.warn('Could not load mastery certifications:', error);
    return [];
  }
}

export async function setMasteryCertification(params: {
  cohortId: string;
  learnerId: string;
  learnerName: string;
  certified: boolean;
  teacherId: string;
  teacherName: string;
}): Promise<MasteryCertification> {
  const certId = `cert_${params.cohortId}_${params.learnerId}`;
  const record: MasteryCertification = {
    id: certId,
    cohortId: params.cohortId,
    learnerId: params.learnerId,
    certified: params.certified,
    certifiedBy: params.teacherId,
    certifiedByName: params.teacherName,
    updatedAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'masteryCertifications', certId), record);
    await logAuditEvent({
      actorId: params.teacherId,
      actorName: params.teacherName,
      actorRole: 'teacher',
      action: params.certified ? 'CERTIFY_MASTERY' : 'REVOKE_MASTERY',
      targetEntity: 'learner',
      targetId: params.learnerId,
      details: `${params.certified ? 'Certified' : 'Revoked'} topic mastery for ${params.learnerName} in cohort ${params.cohortId}.`,
    });
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `masteryCertifications/${certId}`);
    throw error;
  }
}

// ----------------- TEACHER FEEDBACK -----------------
export async function sendTeacherFeedback(
  feedback: Omit<TeacherFeedback, 'id' | 'createdAt' | 'isRead'>
): Promise<void> {
  const docId = `fb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const item = stripUndefinedDeep<TeacherFeedback>({
    ...feedback,
    id: docId,
    isRead: false,
    createdAt: new Date().toISOString(),
  });

  try {
    await setDoc(doc(db, 'teacherFeedback', docId), item);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `teacherFeedback/${docId}`);
    throw error;
  }
}

export async function getFeedbackForLearner(learnerDocId: string): Promise<TeacherFeedback[]> {
  try {
    const q = query(collection(db, 'teacherFeedback'), where('learnerDocId', '==', learnerDocId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id } as TeacherFeedback));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'teacherFeedback');
    return [];
  }
}

// ----------------- AUDIT LOGS -----------------
export async function logAuditEvent(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<void> {
  const docId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const item = stripUndefinedDeep<AuditLog>({
    ...log,
    id: docId,
    timestamp: new Date().toISOString(),
  });

  try {
    await setDoc(doc(db, 'auditLogs', docId), item);
  } catch (error) {
    console.warn('Audit log write error:', error);
  }
}

export async function getAuditLogs(): Promise<AuditLog[]> {
  try {
    const snap = await getDocs(collection(db, 'auditLogs'));
    const logs = snap.docs.map((d) => ({ ...d.data(), id: d.id } as AuditLog));
    return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 50);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'auditLogs');
    return [];
  }
}

// ----------------- SCHOOL SETTINGS -----------------
export async function getSchoolSettings(): Promise<SchoolSetting> {
  const defaultSettings: SchoolSetting = {
    id: 'school_config',
    schoolName: 'Sangurur Comprehensive School',
    schoolMotto: 'THINK, CODE, CHANGE THE WORLD',
    timezone: 'Africa/Nairobi',
    allowLearnerReflections: true,
    lateCutoffTime: '08:30',
    attendanceCutoffTime: '16:30',
    contactEmail: 'sangururschool10@gmail.com',
  };

  try {
    const configRef = doc(db, 'schoolSettings', 'school_config');
    const snap = await getDoc(configRef);
    if (!snap.exists()) {
      await setDoc(configRef, defaultSettings);
      return defaultSettings;
    }
    const existing = snap.data() as SchoolSetting;
    if ((existing.schoolMotto || '').trim().toUpperCase() === 'STRIVE TO RISE') {
      await updateDoc(configRef, { schoolMotto: 'THINK, CODE, CHANGE THE WORLD' });
      return { ...existing, schoolMotto: 'THINK, CODE, CHANGE THE WORLD' };
    }
    return existing;
  } catch (e) {
    return defaultSettings;
  }
}

export async function updateSchoolSettings(
  updates: Partial<SchoolSetting>,
  actor?: { uid: string; fullName: string; role: string }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'schoolSettings', 'school_config'), stripUndefinedDeep(updates));
    await logAuditEvent({
      actorId: actor?.uid || 'teacher_staff',
      actorName: actor?.fullName || 'School Administrator',
      actorRole: actor?.role || 'admin',
      action: 'UPDATE_SCHOOL_SETTINGS',
      targetEntity: 'schoolSettings',
      targetId: 'school_config',
      details: `Updated institution settings (Late Cutoff: ${updates.lateCutoffTime || '—'}, Closing Cutoff: ${updates.attendanceCutoffTime || '—'}, Reflections: ${updates.allowLearnerReflections ? 'Enabled' : 'Disabled'}).`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'schoolSettings/school_config');
    throw error;
  }
}

// ----------------- WEEKLY TIMETABLES (NOV/DEC HOLIDAY & TERMS) -----------------
export function getNairobiTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function getWeeklyTimetable(
  cohortId?: string,
  classId?: string
): Promise<WeeklyTimetableEntry[]> {
  try {
    const colRef = collection(db, 'weeklyTimetables');
    const q = cohortId ? query(colRef, where('cohortId', '==', cohortId)) : colRef;
    const snap = await getDocs(q);
    let items = snap.docs.map((d) => ({ ...d.data(), id: d.id } as WeeklyTimetableEntry));
    if (classId) {
      items = items.filter((item) => item.classId === classId);
    }
    return items.sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      return (a.weekNumber || 0) - (b.weekNumber || 0);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'weeklyTimetables');
    return [];
  }
}

export async function createWeeklyTimetableEntry(
  entry: Omit<WeeklyTimetableEntry, 'id' | 'createdAt'>
): Promise<WeeklyTimetableEntry> {
  const safeTerm = (entry.programmeTerm || 'term')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  const classPart = entry.classId ? `${entry.classId.slice(-8)}_` : '';
  const docId = `tt_${entry.cohortId}_${classPart}${safeTerm}_w${entry.weekNumber}_${Date.now().toString(36)}`;
  const newEntry = stripUndefinedDeep<WeeklyTimetableEntry>({
    ...entry,
    id: docId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    await setDoc(doc(db, 'weeklyTimetables', docId), newEntry);
    return newEntry;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `weeklyTimetables/${docId}`);
    throw error;
  }
}

export async function updateWeeklyTimetableEntry(
  entryId: string,
  updates: Partial<WeeklyTimetableEntry>
): Promise<void> {
  try {
    const ref = doc(db, 'weeklyTimetables', entryId);
    await updateDoc(
      ref,
      stripUndefinedDeep({
        ...updates,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `weeklyTimetables/${entryId}`);
    throw error;
  }
}

export async function deleteWeeklyTimetableEntry(entryId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'weeklyTimetables', entryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `weeklyTimetables/${entryId}`);
    throw error;
  }
}

function buildNovDecHolidayWeekTemplates(facilitatorName: string): Array<{
  weekNumber: number;
  weekLabel: string;
  startDate: string;
  endDate: string;
  weeklyTheme: string;
  topics: TimetableTopicSlot[];
}> {
  return [
    {
      weekNumber: 1,
      weekLabel: 'Week 1: Digital Foundations & Computer Systems',
      startDate: '2026-11-02',
      endDate: '2026-11-06',
      weeklyTheme: 'Hardware architecture, OS file management, typing fluency, and spreadsheet logic',
      topics: [
        {
          id: 'tt_slot_w1_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Input, Processing & Output (IPO) Architecture',
          learningArea: 'Computer Fundamentals',
          facilitator: facilitatorName,
          practicalActivity: 'Inspect desktop lab ports and trace data flow from keyboard to monitor',
        },
        {
          id: 'tt_slot_w1_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Primary & Secondary Storage (RAM, ROM, SSD)',
          learningArea: 'Computer Fundamentals',
          facilitator: facilitatorName,
          practicalActivity: 'Classify classroom storage devices and calculate MB/GB capacities',
        },
        {
          id: 'tt_slot_w1_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Operating Systems & Folder Hierarchy',
          learningArea: 'Digital Productivity',
          facilitator: facilitatorName,
          practicalActivity: 'Create a structured Nov/Dec Holiday portfolio workspace',
        },
        {
          id: 'tt_slot_w1_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Spreadsheet Formulas (SUM, AVERAGE, MIN, MAX)',
          learningArea: 'Computer Applications',
          facilitator: facilitatorName,
          practicalActivity: 'Build an interactive marks calculator with column bar charts',
        },
        {
          id: 'tt_slot_w1_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Week 1 Lab Checkpoint & Typing Challenge',
          learningArea: 'Practical Assessment',
          facilitator: facilitatorName,
          practicalActivity: 'Peer-reviewed folder organization and spreadsheet mini-test',
        },
      ],
    },
    {
      weekNumber: 2,
      weekLabel: 'Week 2: Creative Coding & Visual Logic in Scratch',
      startDate: '2026-11-09',
      endDate: '2026-11-13',
      weeklyTheme: 'Block-based sequencing, Cartesian coordinates, loops, and conditional game events',
      topics: [
        {
          id: 'tt_slot_w2_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Sprites, Costumes & Stage Coordinates (X, Y)',
          learningArea: 'Scratch Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Animate a dancing sprite across the 480x360 coordinate grid',
        },
        {
          id: 'tt_slot_w2_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Event Triggers & Broadcast Messaging',
          learningArea: 'Scratch Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Script two characters conversing with timed broadcast signals',
        },
        {
          id: 'tt_slot_w2_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Loops, Repeats & Conditional Decisions (If-Then)',
          learningArea: 'Scratch Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Build collision detection and wall-bounce logic for a maze runner',
        },
        {
          id: 'tt_slot_w2_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Score Variables, Timers & Sound Effects',
          learningArea: 'Game Design',
          facilitator: facilitatorName,
          practicalActivity: 'Add a live score counter and countdown timer to the maze game',
        },
        {
          id: 'tt_slot_w2_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Week 2 Interactive Story & Quiz Playtest',
          learningArea: 'Practical Assessment',
          facilitator: facilitatorName,
          practicalActivity: 'Demonstrate playable Scratch games and swap feedback',
        },
      ],
    },
    {
      weekNumber: 3,
      weekLabel: 'Week 3: Web Design Mastery — HTML5 & CSS Styling',
      startDate: '2026-11-16',
      endDate: '2026-11-20',
      weeklyTheme: 'Semantic web structure, accessible links/media, CSS box model, and Flexbox responsive pages',
      topics: [
        {
          id: 'tt_slot_w3_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'HTML5 Document Structure, Headings & Paragraphs',
          learningArea: 'Web Technology',
          facilitator: facilitatorName,
          practicalActivity: 'Code a personal learner profile HTML page using semantic tags',
        },
        {
          id: 'tt_slot_w3_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Images, Hyperlinks & Multi-Page Navigation Bars',
          learningArea: 'Web Technology',
          facilitator: facilitatorName,
          practicalActivity: 'Connect Home, Clubs, and Timetable pages with working nav links',
        },
        {
          id: 'tt_slot_w3_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'CSS Selectors, Colors, Typography & Box Model',
          learningArea: 'Web Technology',
          facilitator: facilitatorName,
          practicalActivity: 'Style Sangurur school cards with padding, borders, and brand colors',
        },
        {
          id: 'tt_slot_w3_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Mobile-First Responsive Layouts with Flexbox & Grid',
          learningArea: 'Web Technology',
          facilitator: facilitatorName,
          practicalActivity: 'Make club gallery cards adapt smoothly from phone to desktop',
        },
        {
          id: 'tt_slot_w3_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Week 3 Sangurur School Club Website Mini-Exhibition',
          learningArea: 'Practical Assessment',
          facilitator: facilitatorName,
          practicalActivity: 'Present styled multi-page club websites to peers',
        },
      ],
    },
    {
      weekNumber: 4,
      weekLabel: 'Week 4: Python Coding & Problem Solving',
      startDate: '2026-11-23',
      endDate: '2026-11-27',
      weeklyTheme: 'Core Python syntax, user inputs, conditional branching, loops, and structured problem solving',
      topics: [
        {
          id: 'tt_slot_w4_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Print, Variables & Primitive Data Types (str, int, float)',
          learningArea: 'Python Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Write an interactive greeting & learner ID badge formatter script',
        },
        {
          id: 'tt_slot_w4_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Arithmetic Expressions & Type Casting',
          learningArea: 'Python Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Develop a school tuck-shop & fee balance calculator script',
        },
        {
          id: 'tt_slot_w4_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Conditional Branching: if, elif, else',
          learningArea: 'Python Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Code an automatic CBC rubric & grade categorizer tool',
        },
        {
          id: 'tt_slot_w4_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'For/While Loops & Python Lists',
          learningArea: 'Python Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Build a class attendance tallying loop over student lists',
        },
        {
          id: 'tt_slot_w4_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Week 4 Python Debugging & Quiz Assistant Lab',
          learningArea: 'Practical Assessment',
          facilitator: facilitatorName,
          practicalActivity: 'Test and debug a 5-question console trivia game',
        },
      ],
    },
    {
      weekNumber: 5,
      weekLabel: 'Week 5: Artificial Intelligence & Cyber Safety',
      startDate: '2026-11-30',
      endDate: '2026-12-04',
      weeklyTheme: 'Machine learning concepts, clean training datasets, algorithmic fairness, and online safety',
      topics: [
        {
          id: 'tt_slot_w5_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Rule-Based Programs vs. Machine Learning',
          learningArea: 'Artificial Intelligence',
          facilitator: facilitatorName,
          practicalActivity: 'Compare explicit if-else rules against pattern classifiers',
        },
        {
          id: 'tt_slot_w5_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Training Data, Features & Bias Prevention',
          learningArea: 'Artificial Intelligence',
          facilitator: facilitatorName,
          practicalActivity: 'Curate balanced leaf/crop sample labels and inspect errors',
        },
        {
          id: 'tt_slot_w5_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Password Hygiene & Phishing Defense',
          learningArea: 'Digital Literacy',
          facilitator: facilitatorName,
          practicalActivity: 'Audit sample login prompts and design strong passphrase strategies',
        },
        {
          id: 'tt_slot_w5_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Real-World AI Applications in Kenyan Agriculture & Health',
          learningArea: 'Artificial Intelligence',
          facilitator: facilitatorName,
          practicalActivity: 'Design a community problem-statement poster for an AI helper',
        },
        {
          id: 'tt_slot_w5_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Week 5 Ethical Tech Debate & Vision Demo',
          learningArea: 'Practical Assessment',
          facilitator: facilitatorName,
          practicalActivity: 'Team debate on responsible student AI usage',
        },
      ],
    },
    {
      weekNumber: 6,
      weekLabel: 'Week 6: Holiday Capstone Project & Demo Day',
      startDate: '2026-12-07',
      endDate: '2026-12-11',
      weeklyTheme: 'Team capstone creation, testing, portfolio polish, and Sangurur Holiday Bootcamp Showcase',
      topics: [
        {
          id: 'tt_slot_w6_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Capstone Blueprint & Track Selection (Scratch, Web, or Python)',
          learningArea: 'Capstone Studio',
          facilitator: facilitatorName,
          practicalActivity: 'Draft team project storyboard and milestone checklist',
        },
        {
          id: 'tt_slot_w6_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Core Build Sprint & Peer Pair-Programming',
          learningArea: 'Capstone Studio',
          facilitator: facilitatorName,
          practicalActivity: 'Implement core project features with teacher check-ins',
        },
        {
          id: 'tt_slot_w6_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Usability Testing, Bug Fixing & Documentation',
          learningArea: 'Capstone Studio',
          facilitator: facilitatorName,
          practicalActivity: 'Cross-test classmate projects and log defect fixes',
        },
        {
          id: 'tt_slot_w6_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:30',
          topicTitle: 'Presentation Deck & Live Demo Rehearsal',
          learningArea: 'Capstone Studio',
          facilitator: facilitatorName,
          practicalActivity: 'Rehearse 3-minute student showcase pitches',
        },
        {
          id: 'tt_slot_w6_fri',
          dayOfWeek: 'Friday',
          timeSlot: '09:00 - 12:00',
          topicTitle: 'Nov/Dec Holiday Demo Day & Certificate Awards',
          learningArea: 'Showcase & Certification',
          facilitator: facilitatorName,
          practicalActivity: 'Live project demonstrations & Bootcamp Mastery Certificates',
        },
      ],
    },
  ];
}

export function isUpperJuniorSeniorTrack(
  classContext?: Pick<CohortClass, 'name' | 'gradeBand' | 'code' | 'curriculumId'> | null,
  cohort?: Pick<Cohort, 'learningLevel' | 'name' | 'curriculumId'> | null
): boolean {
  if (
    classContext?.curriculumId === UPPER_JUNIOR_SENIOR_CURRICULUM_ID ||
    (!classContext && cohort?.curriculumId === UPPER_JUNIOR_SENIOR_CURRICULUM_ID)
  ) {
    return true;
  }

  const rawText = classContext
    ? `${classContext.name || ''} ${classContext.gradeBand || ''} ${classContext.code || ''}`
    : `${cohort?.learningLevel || ''} ${cohort?.name || ''}`;
  const text = rawText.toLowerCase();

  const matchesTrack =
    text.includes('upper primary') ||
    text.includes('upper_primary') ||
    text.includes('junior') ||
    text.includes('senior') ||
    text.includes('jss') ||
    text.includes('secondary') ||
    /\bgrade\s*(4|5|6|7|8|9|10|11|12)\b/.test(text) ||
    /\bform\s*(1|2|3|4)\b/.test(text);

  if (matchesTrack) return true;
  if (text.includes('lower primary') || text.includes('play group') || text.includes('early years')) {
    return false;
  }
  return false;
}

function buildUpperJuniorSeniorWeekTemplates(facilitatorName: string): Array<{
  weekNumber: number;
  weekLabel: string;
  startDate: string;
  endDate: string;
  weeklyTheme: string;
  topics: TimetableTopicSlot[];
}> {
  return [
    {
      weekNumber: 1,
      weekLabel: 'Week 1: Office Production and MS Azure',
      startDate: '2026-11-02',
      endDate: '2026-11-06',
      weeklyTheme: '2–6 November • Microsoft Office productivity (Word, Excel, PowerPoint) and MS Azure cloud basics',
      topics: [
        {
          id: 'tt_ujs_w1_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to Microsoft Office',
          learningArea: 'Office Production and MS Azure',
          facilitator: facilitatorName,
          practicalActivity: 'Identify Word, Excel and PowerPoint',
          curriculumTopicId: 'top-ujs-w1-mon',
        },
        {
          id: 'tt_ujs_w1_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Microsoft Word',
          learningArea: 'Office Production and MS Azure',
          facilitator: facilitatorName,
          practicalActivity: 'Type and format a document',
          curriculumTopicId: 'top-ujs-w1-tue',
        },
        {
          id: 'tt_ujs_w1_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Microsoft Excel',
          learningArea: 'Office Production and MS Azure',
          facilitator: facilitatorName,
          practicalActivity: 'Create a table and use formulas',
          curriculumTopicId: 'top-ujs-w1-wed',
        },
        {
          id: 'tt_ujs_w1_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Microsoft PowerPoint',
          learningArea: 'Office Production and MS Azure',
          facilitator: facilitatorName,
          practicalActivity: 'Create 5 presentation slides',
          curriculumTopicId: 'top-ujs-w1-thu',
        },
        {
          id: 'tt_ujs_w1_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to MS Azure',
          learningArea: 'Office Production and MS Azure',
          facilitator: facilitatorName,
          practicalActivity: 'Explore cloud computing and Azure services',
          curriculumTopicId: 'top-ujs-w1-fri',
        },
      ],
    },
    {
      weekNumber: 2,
      weekLabel: 'Week 2: Artificial Intelligence and C Programming',
      startDate: '2026-11-09',
      endDate: '2026-11-13',
      weeklyTheme: '9–13 November • Introduction to AI applications and C programming fundamentals',
      topics: [
        {
          id: 'tt_ujs_w2_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to Artificial Intelligence',
          learningArea: 'Artificial Intelligence and C Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Identify examples of AI',
          curriculumTopicId: 'top-ujs-w2-mon',
        },
        {
          id: 'tt_ujs_w2_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Applications of AI',
          learningArea: 'Artificial Intelligence and C Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Explore AI tools and their uses',
          curriculumTopicId: 'top-ujs-w2-tue',
        },
        {
          id: 'tt_ujs_w2_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to C programming',
          learningArea: 'Artificial Intelligence and C Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Write your first C program',
          curriculumTopicId: 'top-ujs-w2-wed',
        },
        {
          id: 'tt_ujs_w2_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Variables and data types in C',
          learningArea: 'Artificial Intelligence and C Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Create a simple calculator',
          curriculumTopicId: 'top-ujs-w2-thu',
        },
        {
          id: 'tt_ujs_w2_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Conditions and loops in C',
          learningArea: 'Artificial Intelligence and C Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Build a number guessing game',
          curriculumTopicId: 'top-ujs-w2-fri',
        },
      ],
    },
    {
      weekNumber: 3,
      weekLabel: 'Week 3: C++ and Arduino Programming',
      startDate: '2026-11-16',
      endDate: '2026-11-20',
      weeklyTheme: '16–20 November • C++ programming logic and hands-on Arduino hardware control',
      topics: [
        {
          id: 'tt_ujs_w3_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to C++',
          learningArea: 'C++ and Arduino Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Print your name using C++',
          curriculumTopicId: 'top-ujs-w3-mon',
        },
        {
          id: 'tt_ujs_w3_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Variables and operators',
          learningArea: 'C++ and Arduino Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Perform arithmetic operations',
          curriculumTopicId: 'top-ujs-w3-tue',
        },
        {
          id: 'tt_ujs_w3_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Conditions and loops',
          learningArea: 'C++ and Arduino Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Print stars and triangles',
          curriculumTopicId: 'top-ujs-w3-wed',
        },
        {
          id: 'tt_ujs_w3_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to Arduino',
          learningArea: 'C++ and Arduino Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Identify Arduino board components',
          curriculumTopicId: 'top-ujs-w3-thu',
        },
        {
          id: 'tt_ujs_w3_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Arduino programming',
          learningArea: 'C++ and Arduino Programming',
          facilitator: facilitatorName,
          practicalActivity: 'Blink an LED',
          curriculumTopicId: 'top-ujs-w3-fri',
        },
      ],
    },
    {
      weekNumber: 4,
      weekLabel: 'Week 4: DBMS and Database',
      startDate: '2026-11-23',
      endDate: '2026-11-27',
      weeklyTheme: '23–27 November • Databases, DBMS exploration, and SQL table operations',
      topics: [
        {
          id: 'tt_ujs_w4_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to databases',
          learningArea: 'DBMS and Database',
          facilitator: facilitatorName,
          practicalActivity: 'Identify database applications',
          curriculumTopicId: 'top-ujs-w4-mon',
        },
        {
          id: 'tt_ujs_w4_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to DBMS',
          learningArea: 'DBMS and Database',
          facilitator: facilitatorName,
          practicalActivity: 'Explore database management',
          curriculumTopicId: 'top-ujs-w4-tue',
        },
        {
          id: 'tt_ujs_w4_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'SQL and CREATE TABLE',
          learningArea: 'DBMS and Database',
          facilitator: facilitatorName,
          practicalActivity: 'Create a students table',
          curriculumTopicId: 'top-ujs-w4-wed',
        },
        {
          id: 'tt_ujs_w4_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'INSERT, SELECT and UPDATE',
          learningArea: 'DBMS and Database',
          facilitator: facilitatorName,
          practicalActivity: 'Add and retrieve student records',
          curriculumTopicId: 'top-ujs-w4-thu',
        },
        {
          id: 'tt_ujs_w4_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'DELETE and database operations',
          learningArea: 'DBMS and Database',
          facilitator: facilitatorName,
          practicalActivity: 'Build a simple student database',
          curriculumTopicId: 'top-ujs-w4-fri',
        },
      ],
    },
    {
      weekNumber: 5,
      weekLabel: 'Week 5: Python, Java and JavaScript',
      startDate: '2026-11-30',
      endDate: '2026-12-04',
      weeklyTheme: '30 November–4 December • Multi-language coding with Python, Java, and interactive JavaScript',
      topics: [
        {
          id: 'tt_ujs_w5_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to Python',
          learningArea: 'Python, Java and JavaScript',
          facilitator: facilitatorName,
          practicalActivity: 'Print Hello World',
          curriculumTopicId: 'top-ujs-w5-mon',
        },
        {
          id: 'tt_ujs_w5_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Python variables and operators',
          learningArea: 'Python, Java and JavaScript',
          facilitator: facilitatorName,
          practicalActivity: 'Build a calculator',
          curriculumTopicId: 'top-ujs-w5-tue',
        },
        {
          id: 'tt_ujs_w5_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to Java',
          learningArea: 'Python, Java and JavaScript',
          facilitator: facilitatorName,
          practicalActivity: 'Write a simple Java program',
          curriculumTopicId: 'top-ujs-w5-wed',
        },
        {
          id: 'tt_ujs_w5_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to JavaScript',
          learningArea: 'Python, Java and JavaScript',
          facilitator: facilitatorName,
          practicalActivity: 'Display messages on a webpage',
          curriculumTopicId: 'top-ujs-w5-thu',
        },
        {
          id: 'tt_ujs_w5_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'JavaScript functions and events',
          learningArea: 'Python, Java and JavaScript',
          facilitator: facilitatorName,
          practicalActivity: 'Create an interactive button',
          curriculumTopicId: 'top-ujs-w5-fri',
        },
      ],
    },
    {
      weekNumber: 6,
      weekLabel: 'Week 6: Libraries and Projects',
      startDate: '2026-12-07',
      endDate: '2026-12-11',
      weeklyTheme: '7–11 December • Programming libraries, project planning, development, and presentation prep',
      topics: [
        {
          id: 'tt_ujs_w6_mon',
          dayOfWeek: 'Monday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Introduction to programming libraries',
          learningArea: 'Libraries and Projects',
          facilitator: facilitatorName,
          practicalActivity: 'Explore useful libraries',
          curriculumTopicId: 'top-ujs-w6-mon',
        },
        {
          id: 'tt_ujs_w6_tue',
          dayOfWeek: 'Tuesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Using libraries',
          learningArea: 'Libraries and Projects',
          facilitator: facilitatorName,
          practicalActivity: 'Import and use a library',
          curriculumTopicId: 'top-ujs-w6-tue',
        },
        {
          id: 'tt_ujs_w6_wed',
          dayOfWeek: 'Wednesday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Project planning',
          learningArea: 'Libraries and Projects',
          facilitator: facilitatorName,
          practicalActivity: 'Choose and plan your project',
          curriculumTopicId: 'top-ujs-w6-wed',
        },
        {
          id: 'tt_ujs_w6_thu',
          dayOfWeek: 'Thursday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Project development',
          learningArea: 'Libraries and Projects',
          facilitator: facilitatorName,
          practicalActivity: 'Build your project',
          curriculumTopicId: 'top-ujs-w6-thu',
        },
        {
          id: 'tt_ujs_w6_fri',
          dayOfWeek: 'Friday',
          timeSlot: '08:30 - 10:00',
          topicTitle: 'Project testing and preparation',
          learningArea: 'Libraries and Projects',
          facilitator: facilitatorName,
          practicalActivity: 'Test and prepare your presentation',
          curriculumTopicId: 'top-ujs-w6-fri',
        },
      ],
    },
  ];
}

export async function seedNovDecHolidayTimetable(
  cohort: Cohort,
  createdBy: string,
  programmeTerm: string = 'Nov/Dec Holiday 2026',
  classContext?: CohortClass,
  options?: { replaceExisting?: boolean }
): Promise<WeeklyTimetableEntry[]> {
  const allCohortEntries = await getWeeklyTimetable(cohort.id, classContext?.id);
  const scopedExisting = classContext
    ? allCohortEntries
    : allCohortEntries.filter((e) => !e.classId);

  let remainingExisting = scopedExisting;
  if (options?.replaceExisting) {
    const toDelete = scopedExisting.filter((e) => e.programmeTerm === programmeTerm);
    for (const oldEntry of toDelete) {
      await deleteWeeklyTimetableEntry(oldEntry.id);
    }
    remainingExisting = scopedExisting.filter((e) => e.programmeTerm !== programmeTerm);
  }

  const existingWeeks = new Set(
    remainingExisting
      .filter((e) => e.programmeTerm === programmeTerm)
      .map((e) => e.weekNumber)
  );

  const facilitator = classContext?.teacherName || cohort.teacherName || createdBy || 'Sangurur Staff';
  const useUpperJuniorSenior = isUpperJuniorSeniorTrack(classContext, cohort);
  const templates = useUpperJuniorSenior
    ? buildUpperJuniorSeniorWeekTemplates(facilitator)
    : buildNovDecHolidayWeekTemplates(facilitator);
  const created: WeeklyTimetableEntry[] = [];

  for (const tmpl of templates) {
    if (existingWeeks.has(tmpl.weekNumber)) continue;
    const classCourses = classContext?.coursesOffered || [];
    const mappedTopics = useUpperJuniorSenior
      ? tmpl.topics.map((slot) => ({
          ...slot,
          id: `${slot.id}_${classContext?.id?.slice(-4) || 'c'}`,
        }))
      : classCourses.length > 0
      ? tmpl.topics.map((slot, idx) => ({
          ...slot,
          id: `${slot.id}_${classContext?.id?.slice(-4) || 'c'}`,
          learningArea: classCourses[idx % classCourses.length]?.title || slot.learningArea,
        }))
      : tmpl.topics;

    const rawWeekLabel = classContext ? `${tmpl.weekLabel} (${classContext.name})` : tmpl.weekLabel;
    const entry = await createWeeklyTimetableEntry({
      cohortId: cohort.id,
      cohortCode: cohort.code,
      ...(classContext
        ? {
            levelId: classContext.levelId,
            levelName: classContext.levelName,
            classId: classContext.id,
            className: classContext.name,
          }
        : {}),
      programmeTerm,
      weekNumber: tmpl.weekNumber,
      weekLabel: rawWeekLabel.slice(0, 128),
      startDate: tmpl.startDate,
      endDate: tmpl.endDate,
      weeklyTheme: tmpl.weeklyTheme,
      topics: mappedTopics,
      createdBy: createdBy || 'Sangurur Staff',
    });
    created.push(entry);
  }

  const refreshed = classContext
    ? [...remainingExisting, ...created]
    : [...allCohortEntries.filter((e) => Boolean(e.classId)), ...remainingExisting, ...created];

  return refreshed.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    return (a.weekNumber || 0) - (b.weekNumber || 0);
  });
}

// ----------------- CLIENT-SIDE STAFF OPERATIONS (GOOGLE AUTH / DIRECT FIRESTORE) -----------------
const DEFAULT_INITIAL_LEARNER_PASSWORD = '123456789';

function generateBrowserSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPasswordBrowser(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 1000,
      hash: 'SHA-512',
    },
    keyMaterial,
    64 * 8
  );
  return Array.from(new Uint8Array(derivedBits), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getNextLearnerDigitalIdsDirect(count: number): Promise<string[]> {
  const snap = await getDocs(collection(db, 'learners'));
  let maxSeq = 0;
  snap.docs.forEach((d) => {
    const data = d.data();
    const idStr = String(data.digitalId || data.learnerId || data.username || '');
    const match = idStr.match(/^SG-LRN-2026-(\d+)$/i) || idStr.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  });
  return Array.from(
    { length: count },
    (_, i) => `SG-LRN-2026-${String(maxSeq + 1 + i).padStart(3, '0')}`
  );
}

export async function createLearnerDirect(params: {
  fullName: string;
  cohortId: string;
  levelId?: string;
  levelName?: string;
  classId?: string;
  className?: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  age?: number;
  schoolName?: string;
  grade?: string;
  guardianContact?: string;
  customDigitalId?: string;
  teacherId: string;
  teacherName: string;
  teacherRole?: string;
}): Promise<Learner> {
  if (!auth.currentUser) {
    throw new Error('Staff authentication required. Please sign in again.');
  }

  try {
    const cohortSnap = await getDoc(doc(db, 'cohorts', params.cohortId));
    if (!cohortSnap.exists()) {
      throw new Error('Selected cohort was not found.');
    }

    let resolvedLevelId = params.levelId || null;
    let resolvedLevelName = params.levelName || null;
    let resolvedClassId = params.classId || null;
    let resolvedClassName = params.className || null;

    if (params.classId) {
      const classSnap = await getDoc(doc(db, 'cohortClasses', params.classId));
      if (classSnap.exists()) {
        const clsData = classSnap.data() as CohortClass;
        resolvedClassId = classSnap.id;
        resolvedClassName = clsData.name;
        resolvedLevelId = clsData.levelId;
        resolvedLevelName = clsData.levelName;
      }
    }

    let digitalId = '';
    if (params.customDigitalId && params.customDigitalId.trim()) {
      digitalId = params.customDigitalId.trim().toUpperCase();
      const dupSnap = await getDocs(
        query(collection(db, 'learners'), where('digitalId', '==', digitalId))
      );
      if (!dupSnap.empty) {
        throw new Error(`Digital ID ${digitalId} is already assigned to another learner.`);
      }
    } else {
      [digitalId] = await getNextLearnerDigitalIdsDirect(1);
    }

    const salt = generateBrowserSalt();
    const passwordHash = await hashPasswordBrowser(DEFAULT_INITIAL_LEARNER_PASSWORD, salt);
    const docId = `learner_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    const newLearnerRecord = {
      id: docId,
      fullName: params.fullName.trim(),
      digitalId,
      learnerId: digitalId,
      username: digitalId,
      gender: params.gender || null,
      age: params.age ? Number(params.age) : null,
      schoolName: params.schoolName?.trim() || 'Sangurur Comprehensive School',
      grade: params.grade?.trim() || null,
      guardianContact: params.guardianContact?.trim() || null,
      assignedCohortIds: [params.cohortId],
      assignedClassIds: resolvedClassId ? [resolvedClassId] : [],
      levelId: resolvedLevelId,
      levelName: resolvedLevelName,
      classId: resolvedClassId,
      className: resolvedClassName,
      mustChangePassword: true,
      isFirstLogin: true,
      status: 'ACTIVE' as const,
      active: true,
      passwordHash,
      salt,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(doc(db, 'learners', docId), newLearnerRecord);

    const memberId = `mem_${params.cohortId}_${docId}`;
    await setDoc(doc(db, 'cohortMembers', memberId), {
      id: memberId,
      cohortId: params.cohortId,
      learnerId: docId,
      learnerName: newLearnerRecord.fullName,
      learnerCode: digitalId,
      ...(resolvedLevelId ? { levelId: resolvedLevelId, levelName: resolvedLevelName } : {}),
      ...(resolvedClassId ? { classId: resolvedClassId, className: resolvedClassName } : {}),
      joinedAt: now,
      status: 'active',
    });

    await logAuditEvent({
      actorId: params.teacherId,
      actorName: params.teacherName,
      actorRole: params.teacherRole || 'teacher',
      action: 'CREATE_LEARNER',
      targetEntity: 'learner',
      targetId: docId,
      details: `Registered learner ${newLearnerRecord.fullName} with Digital ID ${digitalId} in cohort ${params.cohortId}${resolvedClassName ? ` (${resolvedLevelName || ''} / ${resolvedClassName})` : ''}.`,
    });

    const { passwordHash: _ph, salt: _s, ...publicLearner } = newLearnerRecord;
    return {
      ...(publicLearner as unknown as Learner),
      initialPassword: DEFAULT_INITIAL_LEARNER_PASSWORD,
    };
  } catch (error: any) {
    if (error?.message?.includes('already assigned') || error?.message?.includes('not found')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, 'learners');
    throw error;
  }
}

export async function bulkImportLearnersDirect(params: {
  cohortId: string;
  levelId?: string;
  levelName?: string;
  classId?: string;
  className?: string;
  learners: Array<{
    fullName: string;
    schoolName?: string;
    grade?: string;
    gender?: string;
    age?: number;
    guardianContact?: string;
  }>;
  teacherId: string;
  teacherName: string;
  teacherRole?: string;
}): Promise<{ createdCount: number; learners: Learner[]; errors: string[] }> {
  if (!auth.currentUser) {
    throw new Error('Staff authentication required. Please sign in again.');
  }

  try {
    const cohortSnap = await getDoc(doc(db, 'cohorts', params.cohortId));
    if (!cohortSnap.exists()) {
      throw new Error('Selected cohort was not found.');
    }

    let resolvedLevelId = params.levelId || null;
    let resolvedLevelName = params.levelName || null;
    let resolvedClassId = params.classId || null;
    let resolvedClassName = params.className || null;

    if (params.classId) {
      const classSnap = await getDoc(doc(db, 'cohortClasses', params.classId));
      if (classSnap.exists()) {
        const clsData = classSnap.data() as CohortClass;
        resolvedClassId = classSnap.id;
        resolvedClassName = clsData.name;
        resolvedLevelId = clsData.levelId;
        resolvedLevelName = clsData.levelName;
      }
    }

    const validItems = params.learners.filter((item) => String(item.fullName || '').trim().length > 0);
    if (validItems.length === 0) {
      throw new Error('No valid learner rows found in upload.');
    }

    const allocatedIds = await getNextLearnerDigitalIdsDirect(validItems.length);
    const createdList: Learner[] = [];
    const errors: string[] = [];

    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      try {
        const fullName = String(item.fullName).trim();
        const digitalId = allocatedIds[i];
        const salt = generateBrowserSalt();
        const passwordHash = await hashPasswordBrowser(DEFAULT_INITIAL_LEARNER_PASSWORD, salt);
        const docId = `learner_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`;
        const now = new Date().toISOString();

        const newLearnerRecord = {
          id: docId,
          fullName,
          digitalId,
          learnerId: digitalId,
          username: digitalId,
          gender: item.gender || null,
          age: item.age ? Number(item.age) : null,
          schoolName: item.schoolName?.trim() || 'Sangurur Comprehensive School',
          grade: item.grade?.trim() || null,
          guardianContact: item.guardianContact?.trim() || null,
          assignedCohortIds: [params.cohortId],
          assignedClassIds: resolvedClassId ? [resolvedClassId] : [],
          levelId: resolvedLevelId,
          levelName: resolvedLevelName,
          classId: resolvedClassId,
          className: resolvedClassName,
          mustChangePassword: true,
          isFirstLogin: true,
          status: 'ACTIVE' as const,
          active: true,
          passwordHash,
          salt,
          createdAt: now,
          updatedAt: now,
        };

        await setDoc(doc(db, 'learners', docId), newLearnerRecord);

        const memberId = `mem_${params.cohortId}_${docId}`;
        await setDoc(doc(db, 'cohortMembers', memberId), {
          id: memberId,
          cohortId: params.cohortId,
          learnerId: docId,
          learnerName: fullName,
          learnerCode: digitalId,
          ...(resolvedLevelId ? { levelId: resolvedLevelId, levelName: resolvedLevelName } : {}),
          ...(resolvedClassId ? { classId: resolvedClassId, className: resolvedClassName } : {}),
          joinedAt: now,
          status: 'active',
        });

        const { passwordHash: _ph, salt: _s, ...publicLearner } = newLearnerRecord;
        createdList.push({
          ...(publicLearner as unknown as Learner),
          initialPassword: DEFAULT_INITIAL_LEARNER_PASSWORD,
        });
      } catch (err: any) {
        errors.push(`Error registering ${item.fullName}: ${err.message}`);
      }
    }

    await logAuditEvent({
      actorId: params.teacherId,
      actorName: params.teacherName,
      actorRole: params.teacherRole || 'teacher',
      action: 'BULK_IMPORT_LEARNERS',
      targetEntity: 'cohort',
      targetId: params.cohortId,
      details: `Bulk imported ${createdList.length} learners into cohort ${params.cohortId}${resolvedClassName ? ` (${resolvedClassName})` : ''} (${allocatedIds[0]} to ${allocatedIds[allocatedIds.length - 1]}).`,
    });

    return {
      createdCount: createdList.length,
      learners: createdList,
      errors,
    };
  } catch (error: any) {
    if (error?.message?.includes('not found') || error?.message?.includes('No valid')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, 'learners');
    throw error;
  }
}

export async function resetLearnerPasswordDirect(params: {
  learnerId: string;
  teacherId: string;
  teacherName: string;
  teacherRole?: string;
}): Promise<{ digitalId: string; learnerName: string; initialPassword: string }> {
  if (!auth.currentUser) {
    throw new Error('Staff authentication required. Please sign in again.');
  }

  try {
    const learnerRef = doc(db, 'learners', params.learnerId);
    const snap = await getDoc(learnerRef);
    if (!snap.exists()) {
      throw new Error('Learner account not found');
    }
    const learnerData = snap.data();

    const salt = generateBrowserSalt();
    const passwordHash = await hashPasswordBrowser(DEFAULT_INITIAL_LEARNER_PASSWORD, salt);

    await updateDoc(learnerRef, {
      passwordHash,
      salt,
      mustChangePassword: true,
      isFirstLogin: true,
      status: 'ACTIVE',
      active: true,
      sessionRevokedAt: Date.now(),
      updatedAt: new Date().toISOString(),
    });

    const digitalId = String(learnerData.digitalId || learnerData.learnerId || '');
    await logAuditEvent({
      actorId: params.teacherId,
      actorName: params.teacherName,
      actorRole: params.teacherRole || 'teacher',
      action: 'RESET_LEARNER_PASSWORD',
      targetEntity: 'learner',
      targetId: params.learnerId,
      details: `Authorised password reset to default '123456789' with mustChangePassword=true for ${learnerData.fullName} (Digital ID: ${digitalId})`,
    });

    return {
      digitalId,
      learnerName: String(learnerData.fullName || ''),
      initialPassword: DEFAULT_INITIAL_LEARNER_PASSWORD,
    };
  } catch (error: any) {
    if (error?.message?.includes('not found')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `learners/${params.learnerId}`);
    throw error;
  }
}

export async function bulkUploadHistoricalAttendanceDirect(params: {
  cohortId?: string;
  entries: Array<{
    rowNumber?: number;
    date: string;
    status: string;
    cohortCode?: string;
    learnerId?: string;
    learnerName?: string;
    understandingLevel?: string;
    teacherNote?: string;
    topicTitle?: string;
  }>;
  conflictMode?: 'skip' | 'overwrite';
  sessionLabel?: string;
  teacherId: string;
  teacherName: string;
  teacherRole?: string;
}): Promise<{
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
  skipped: string[];
  uploadedDates: string[];
}> {
  if (!auth.currentUser) {
    throw new Error('Staff authentication required. Please sign in again.');
  }

  try {
    const [cohortsSnap, learnersSnap] = await Promise.all([
      getDocs(collection(db, 'cohorts')),
      getDocs(collection(db, 'learners')),
    ]);

    const cohortsById = new Map<string, Cohort>();
    const cohortsByCode = new Map<string, Cohort>();
    cohortsSnap.docs.forEach((d) => {
      const c = { ...d.data(), id: d.id } as Cohort;
      cohortsById.set(d.id, c);
      if (c.code) cohortsByCode.set(String(c.code).trim().toUpperCase(), c);
    });

    const defaultCohort = params.cohortId ? cohortsById.get(params.cohortId) : undefined;
    if (params.cohortId && !defaultCohort) {
      throw new Error('Selected target cohort was not found.');
    }

    const learnersList = learnersSnap.docs.map((d) => ({ ...d.data(), id: d.id } as Learner));
    const learnersByDigitalId = new Map<string, Learner>();
    learnersList.forEach((l) => {
      [l.digitalId, l.learnerId, l.username, l.id].filter(Boolean).forEach((k) => {
        learnersByDigitalId.set(String(k).trim().toUpperCase(), l);
      });
    });

    const nairobiToday = getNairobiTodayYmd();
    const cleanSessionLabel = params.sessionLabel ? params.sessionLabel.trim().slice(0, 120) : '';
    const mode: 'skip' | 'overwrite' = params.conflictMode === 'overwrite' ? 'overwrite' : 'skip';

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const skipped: string[] = [];
    const uploadedDates = new Set<string>();

    for (let i = 0; i < params.entries.length; i++) {
      const item = params.entries[i];
      const rowNum = item.rowNumber || i + 1;
      const dateStr = String(item.date || '').trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        errors.push(`Row ${rowNum}: Invalid date "${dateStr}". Expected YYYY-MM-DD.`);
        continue;
      }
      if (dateStr > nairobiToday) {
        errors.push(`Row ${rowNum}: Date ${dateStr} is in the future (today is ${nairobiToday}).`);
        continue;
      }

      const status = String(item.status || '').trim().toLowerCase() as AttendanceStatus;
      if (!['present', 'late', 'absent', 'excused'].includes(status)) {
        errors.push(`Row ${rowNum}: Invalid status "${item.status}".`);
        continue;
      }

      let targetCohort = defaultCohort;
      if (item.cohortCode) {
        const byCode = cohortsByCode.get(String(item.cohortCode).trim().toUpperCase());
        if (byCode) targetCohort = byCode;
        else if (!targetCohort) {
          errors.push(`Row ${rowNum}: Cohort code "${item.cohortCode}" was not found.`);
          continue;
        }
      }
      if (!targetCohort) {
        errors.push(`Row ${rowNum}: No target cohort specified.`);
        continue;
      }

      const rawId = item.learnerId ? String(item.learnerId).trim().toUpperCase() : '';
      const rawName = item.learnerName ? String(item.learnerName).trim().toLowerCase() : '';
      let matchedLearner = rawId ? learnersByDigitalId.get(rawId) : undefined;
      if (!matchedLearner && rawName) {
        matchedLearner =
          learnersList.find(
            (l) =>
              String(l.fullName || '').trim().toLowerCase() === rawName &&
              Array.isArray(l.assignedCohortIds) &&
              (l.assignedCohortIds.includes(targetCohort!.id) || l.assignedCohortIds.includes(targetCohort!.code))
          ) || learnersList.find((l) => String(l.fullName || '').trim().toLowerCase() === rawName);
      }

      if (!matchedLearner) {
        errors.push(`Row ${rowNum}: Learner "${item.learnerId || item.learnerName || 'Unknown'}" was not found.`);
        continue;
      }

      const docId = `reg_${targetCohort.id}_${matchedLearner.id}_${dateStr}`;
      const regRef = doc(db, 'dailyRegisters', docId);
      const existingSnap = await getDoc(regRef);

      const learnerDigitalId = matchedLearner.digitalId || matchedLearner.learnerId;
      const validUnderstanding = ['excellent', 'good', 'fair', 'needs_support'].includes(
        String(item.understandingLevel || '').trim()
      )
        ? (String(item.understandingLevel).trim() as DailyRegister['understandingLevel'])
        : null;
      const noteText = item.teacherNote
        ? String(item.teacherNote).trim().slice(0, 1024)
        : cleanSessionLabel
        ? `Historical Excel Upload (${cleanSessionLabel})`
        : 'Historical Excel Register Upload';
      const topicText = item.topicTitle
        ? String(item.topicTitle).trim().slice(0, 128)
        : cleanSessionLabel || null;

      if (existingSnap.exists()) {
        if (mode === 'skip') {
          skippedCount++;
          skipped.push(`Row ${rowNum}: ${matchedLearner.fullName} (${dateStr}) already exists`);
          continue;
        }
        const existingData = existingSnap.data() as DailyRegister;
        const prevHistory = Array.isArray(existingData.correctionHistory) ? existingData.correctionHistory : [];
        const correctionEntry: CorrectionRecord = {
          correctedBy: params.teacherId,
          correctedByName: params.teacherName,
          timestamp: new Date().toISOString(),
          previousStatus: existingData.status,
          newStatus: status,
          reason: noteText,
        };

        await updateDoc(regRef, {
          cohortId: targetCohort.id,
          cohortCode: targetCohort.code || 'COHORT',
          learnerDocId: matchedLearner.id,
          learnerId: learnerDigitalId,
          learnerName: matchedLearner.fullName,
          date: dateStr,
          status,
          verificationStatus: 'corrected',
          topicTitle: topicText ?? existingData.topicTitle ?? null,
          understandingLevel: validUnderstanding ?? existingData.understandingLevel ?? null,
          teacherNote: noteText,
          reviewedBy: params.teacherId,
          reviewedAt: new Date().toISOString(),
          correctionHistory: [...prevHistory, correctionEntry],
        });
        updatedCount++;
        uploadedDates.add(dateStr);
      } else {
        await setDoc(regRef, {
          id: docId,
          cohortId: targetCohort.id,
          cohortCode: targetCohort.code || 'COHORT',
          learnerDocId: matchedLearner.id,
          learnerId: learnerDigitalId,
          learnerName: matchedLearner.fullName,
          date: dateStr,
          timestamp: `${dateStr}T08:00:00+03:00`,
          status,
          verificationStatus: 'verified',
          topicTitle: topicText,
          understandingLevel: validUnderstanding,
          teacherNote: noteText,
          reviewedBy: params.teacherId,
          reviewedAt: new Date().toISOString(),
          correctionHistory: [],
        });
        createdCount++;
        uploadedDates.add(dateStr);
      }
    }

    const sortedDates = Array.from(uploadedDates).sort();
    if (createdCount > 0 || updatedCount > 0) {
      await logAuditEvent({
        actorId: params.teacherId,
        actorName: params.teacherName,
        actorRole: params.teacherRole || 'teacher',
        action: 'BULK_UPLOAD_HISTORICAL_REGISTER',
        targetEntity: 'dailyRegister',
        targetId: defaultCohort?.id || 'multi_cohort',
        details: `Uploaded previous dates Excel register${cleanSessionLabel ? ` (${cleanSessionLabel})` : ''}: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped.`,
      });
    }

    return {
      createdCount,
      updatedCount,
      skippedCount,
      failedCount: errors.length,
      errors,
      skipped,
      uploadedDates: sortedDates,
    };
  } catch (error: any) {
    if (error?.message?.includes('not found')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, 'dailyRegisters');
    throw error;
  }
}
