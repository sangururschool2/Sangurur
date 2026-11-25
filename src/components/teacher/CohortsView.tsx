import React, { useState, useMemo } from 'react';
import {
  Cohort,
  CohortLevel,
  CohortClass,
  CourseOffered,
  Learner,
  Curriculum,
  Teacher,
  DailyRegister,
  AGE_BRACKET_OPTIONS,
  CLASS_LEVEL_PRESETS,
  ClassPresetMeta,
} from '../../types';
import {
  createCohort,
  updateCohort,
  deleteCohort,
  assignLearnerToCohort,
  removeLearnerFromCohort,
  seedNovDecHolidayTimetable,
  createCohortLevel,
  updateCohortLevel,
  deleteCohortLevel,
  createCohortClass,
  updateCohortClass,
  deleteCohortClass,
  buildDefaultCoursesFromCurriculum,
  UPPER_JUNIOR_SENIOR_CURRICULUM_ID,
  isUpperJuniorSeniorTrack,
} from '../../services/dataService';
import { generateBootcampCertificatePDF } from '../../services/pdfReportGenerator';
import { WeeklyTimetableView } from './WeeklyTimetableView';
import {
  Users,
  Plus,
  BookOpen,
  Archive,
  Edit2,
  X,
  Search,
  UserPlus,
  Trash2,
  ChevronRight,
  AlertCircle,
  ClipboardCheck,
  Award,
  CalendarDays,
  Layers,
  GraduationCap,
  FolderKanban,
  Clock,
  Sparkles,
} from 'lucide-react';

interface CohortsViewProps {
  cohorts: Cohort[];
  cohortLevels?: CohortLevel[];
  cohortClasses?: CohortClass[];
  allLearners: Learner[];
  curricula: Curriculum[];
  teachers?: Teacher[];
  registers?: DailyRegister[];
  currentTeacherId: string;
  currentTeacherName: string;
  isAdmin?: boolean;
  onRefresh: () => Promise<void>;
}

const LEVEL_NAME_SUGGESTIONS = [
  'August Holiday Bootcamp Training',
  'Nov/Dec Holiday Bootcamp Training',
  'April Holiday Bootcamp Training',
  'Term 1 Academic Programme',
  'Term 2 Academic Programme',
  'Term 3 Academic Programme',
];

export const CohortsView: React.FC<CohortsViewProps> = ({
  cohorts,
  cohortLevels = [],
  cohortClasses = [],
  allLearners,
  curricula,
  teachers = [],
  registers = [],
  currentTeacherId,
  currentTeacherName,
  isAdmin = false,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('active');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCohort, setEditingCohort] = useState<Cohort | null>(null);
  const [selectedCohort, setSelectedCohort] = useState<Cohort | null>(null);
  const [drawerTab, setDrawerTab] = useState<
    'structure' | 'learners' | 'timetable' | 'curriculum' | 'analytics'
  >('structure');
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  // Selected Class inside Cohort Structure Workspace
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [classSubTab, setClassSubTab] = useState<'courses' | 'timetable' | 'students'>('courses');

  // Level Modal State
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [editingLevel, setEditingLevel] = useState<CohortLevel | null>(null);
  const [levelName, setLevelName] = useState('');
  const [levelCode, setLevelCode] = useState('');
  const [levelTerm, setLevelTerm] = useState('August Holiday 2026');
  const [levelStartDate, setLevelStartDate] = useState('2026-08-03');
  const [levelEndDate, setLevelEndDate] = useState('2026-08-28');
  const [levelDescription, setLevelDescription] = useState('');
  const [savingLevel, setSavingLevel] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [confirmDeleteLevel, setConfirmDeleteLevel] = useState<CohortLevel | null>(null);

  // Class Modal State
  const [showClassModal, setShowClassModal] = useState(false);
  const [targetLevelForClass, setTargetLevelForClass] = useState<CohortLevel | null>(null);
  const [editingClass, setEditingClass] = useState<CohortClass | null>(null);
  const [className, setClassName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [classGradeBand, setClassGradeBand] = useState('');
  const [classAgeBracket, setClassAgeBracket] = useState('');
  const [classDescription, setClassDescription] = useState('');
  const [classTeacherId, setClassTeacherId] = useState(currentTeacherId);
  const [classCurriculumId, setClassCurriculumId] = useState('');
  const [classCourses, setClassCourses] = useState<CourseOffered[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseCategory, setNewCourseCategory] = useState('Computing');
  const [newCourseHours, setNewCourseHours] = useState('4 hrs/week');
  const [newCourseDesc, setNewCourseDesc] = useState('');
  const [savingClass, setSavingClass] = useState(false);
  const [applyingOfficialTrack, setApplyingOfficialTrack] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);
  const [confirmDeleteClass, setConfirmDeleteClass] = useState<CohortClass | null>(null);

  // Confirm delete cohort modal
  const [confirmDeleteCohort, setConfirmDeleteCohort] = useState<Cohort | null>(null);
  const [deletingCohort, setDeletingCohort] = useState(false);

  // Confirm remove learner modal
  const [confirmRemoveLearner, setConfirmRemoveLearner] = useState<Learner | null>(null);
  const [removingLearner, setRemovingLearner] = useState(false);

  // Form State (Cohort)
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [programme, setProgramme] = useState('Junior School CBC Computing');
  const [description, setDescription] = useState('');
  const [learningLevel, setLearningLevel] = useState('Grade 7');
  const [ageBracket, setAgeBracket] = useState(AGE_BRACKET_OPTIONS[3]);
  const [startDate, setStartDate] = useState('2026-01-12');
  const [endDate, setEndDate] = useState('2026-11-20');
  const [assignedTeacherId, setAssignedTeacherId] = useState(currentTeacherId);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Add Learner to selected cohort/class modal
  const [showAddLearnerModal, setShowAddLearnerModal] = useState(false);
  const [selectedLearnerToAdd, setSelectedLearnerToAdd] = useState('');
  const [enrollTargetClassId, setEnrollTargetClassId] = useState('');

  const filteredCohorts = cohorts.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.programme.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleOpenCreate = () => {
    setName('');
    setCode(`GR7-${Math.random().toString(36).substring(2, 5).toUpperCase()}-2026`);
    setProgramme('Junior Secondary CBC Computing');
    setDescription('Standard digital skills and learner register cohort.');
    setLearningLevel('Grade 7');
    setAgeBracket(AGE_BRACKET_OPTIONS[3]);
    setStartDate('2026-01-12');
    setEndDate('2026-11-20');
    setAssignedTeacherId(currentTeacherId);
    setSelectedCurriculumId(curricula[0]?.id || '');
    setEditingCohort(null);
    setModalError(null);
    setShowCreateModal(true);
  };

  const handleOpenEdit = (c: Cohort) => {
    setEditingCohort(c);
    setName(c.name);
    setCode(c.code);
    setProgramme(c.programme);
    setDescription(c.description);
    setLearningLevel(c.learningLevel);
    setAgeBracket(c.ageBracket || AGE_BRACKET_OPTIONS[3]);
    setStartDate(c.startDate);
    setEndDate(c.endDate);
    setAssignedTeacherId(c.teacherId || currentTeacherId);
    setSelectedCurriculumId(c.curriculumId || '');
    setModalError(null);
    setShowCreateModal(true);
  };

  const handleSaveCohort = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setModalError(null);

    try {
      const normalizedCode = code.trim().toUpperCase();
      const duplicateCode = cohorts.find(
        (c) => c.code.toUpperCase() === normalizedCode && c.id !== editingCohort?.id
      );
      if (duplicateCode) {
        throw new Error(`Cohort code "${normalizedCode}" already exists. Please use a unique cohort code.`);
      }

      const chosenCurr = curricula.find((c) => c.id === selectedCurriculumId);
      const curriculumChanged = !editingCohort || editingCohort.curriculumId !== selectedCurriculumId;

      const curriculumSnapshot =
        chosenCurr && curriculumChanged
          ? {
              curriculumId: chosenCurr.id,
              curriculumTitle: chosenCurr.title,
              version: chosenCurr.version || 1,
              snapshotDate: new Date().toISOString(),
              learningAreas: chosenCurr.learningAreas,
            }
          : editingCohort?.curriculumSnapshot;

      const selectedTeacher = teachers.find((t) => t.uid === assignedTeacherId);
      const teacherIdToSave = selectedTeacher?.uid || assignedTeacherId || currentTeacherId;
      const teacherNameToSave =
        selectedTeacher?.fullName ||
        (teacherIdToSave === currentTeacherId ? currentTeacherName : editingCohort?.teacherName || currentTeacherName);

      if (editingCohort) {
        await updateCohort(editingCohort.id, {
          name,
          code: normalizedCode,
          programme,
          description,
          learningLevel,
          ageBracket: ageBracket.trim() || undefined,
          startDate,
          endDate,
          teacherId: teacherIdToSave,
          teacherName: teacherNameToSave,
          curriculumId: selectedCurriculumId,
          ...(curriculumSnapshot && { curriculumSnapshot }),
        });
        await onRefresh();
        setShowCreateModal(false);
      } else {
        const createdCohort = await createCohort({
          name,
          code: normalizedCode,
          programme,
          description,
          learningLevel,
          ageBracket: ageBracket.trim() || undefined,
          startDate,
          endDate,
          teacherId: teacherIdToSave,
          teacherName: teacherNameToSave,
          curriculumId: selectedCurriculumId,
          curriculumSnapshot,
          status: 'active',
        });

        // Automatically initialize weekly timetable inside the newly created cohort
        try {
          await seedNovDecHolidayTimetable(createdCohort, teacherNameToSave, 'Nov/Dec Holiday 2026');
        } catch (ttErr) {
          console.warn('Auto-seeding cohort weekly timetable warning:', ttErr);
        }

        await onRefresh();
        setShowCreateModal(false);
        setSelectedCohort(createdCohort);
        setSelectedClassId(null);
        setDrawerTab('structure');
      }
    } catch (err: any) {
      setModalError(err.message || 'Error saving cohort');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchiveToggle = async (c: Cohort) => {
    setBannerError(null);
    try {
      const nextStatus = c.status === 'archived' ? 'active' : 'archived';
      await updateCohort(c.id, { status: nextStatus });
      await onRefresh();
      if (selectedCohort?.id === c.id) {
        setSelectedCohort({ ...selectedCohort, status: nextStatus });
      }
    } catch (err: any) {
      setBannerError(err.message || 'Error updating cohort status');
    }
  };

  const handleConfirmDeleteCohort = async () => {
    if (!confirmDeleteCohort) return;
    setDeletingCohort(true);
    setBannerError(null);
    try {
      const deletedName = confirmDeleteCohort.name;
      const deletedCode = confirmDeleteCohort.code;
      await deleteCohort(confirmDeleteCohort.id, {
        uid: currentTeacherId,
        fullName: currentTeacherName,
        role: isAdmin ? 'admin' : 'teacher',
      });
      if (selectedCohort?.id === confirmDeleteCohort.id) {
        setSelectedCohort(null);
        setSelectedClassId(null);
      }
      setConfirmDeleteCohort(null);
      await onRefresh();
      setBannerSuccess(`Deleted cohort "${deletedName}" (${deletedCode}).`);
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to delete cohort.');
      setConfirmDeleteCohort(null);
    } finally {
      setDeletingCohort(false);
    }
  };

  // ---------- LEVEL HANDLERS ----------
  const handleOpenCreateLevel = () => {
    if (!selectedCohort) return;
    setEditingLevel(null);
    setLevelName('August Holiday Bootcamp Training');
    setLevelCode(`LVL-${Math.random().toString(36).substring(2, 5).toUpperCase()}`);
    setLevelTerm('August Holiday 2026');
    setLevelStartDate('2026-08-03');
    setLevelEndDate('2026-08-28');
    setLevelDescription('Cohort training level organizing classes, courses offered, and weekly schedules.');
    setLevelError(null);
    setShowLevelModal(true);
  };

  const handleOpenEditLevel = (lvl: CohortLevel) => {
    setEditingLevel(lvl);
    setLevelName(lvl.name);
    setLevelCode(lvl.code || '');
    setLevelTerm(lvl.termOrSeason || '');
    setLevelStartDate(lvl.startDate || '');
    setLevelEndDate(lvl.endDate || '');
    setLevelDescription(lvl.description || '');
    setLevelError(null);
    setShowLevelModal(true);
  };

  const handleSaveLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCohort) return;
    if (!levelName.trim()) {
      setLevelError('Level name is required.');
      return;
    }
    setSavingLevel(true);
    setLevelError(null);
    try {
      if (editingLevel) {
        await updateCohortLevel(editingLevel.id, {
          name: levelName.trim(),
          code: levelCode.trim().toUpperCase() || undefined,
          termOrSeason: levelTerm.trim() || undefined,
          startDate: levelStartDate || undefined,
          endDate: levelEndDate || undefined,
          description: levelDescription.trim() || undefined,
        });
        setBannerSuccess(`Updated level "${levelName.trim()}".`);
      } else {
        await createCohortLevel({
          cohortId: selectedCohort.id,
          name: levelName.trim(),
          code: levelCode.trim().toUpperCase() || undefined,
          termOrSeason: levelTerm.trim() || undefined,
          startDate: levelStartDate || undefined,
          endDate: levelEndDate || undefined,
          description: levelDescription.trim() || undefined,
          status: 'active',
          createdBy: currentTeacherName,
        });
        setBannerSuccess(`Created level "${levelName.trim()}". Now add classes inside it!`);
      }
      await onRefresh();
      setShowLevelModal(false);
    } catch (err: any) {
      setLevelError(err?.message || 'Could not save level');
    } finally {
      setSavingLevel(false);
    }
  };

  const handleConfirmDeleteLevel = async () => {
    if (!confirmDeleteLevel) return;
    setBannerError(null);
    try {
      const childClasses = cohortClasses.filter((c) => c.levelId === confirmDeleteLevel.id);
      for (const cls of childClasses) {
        await deleteCohortClass(cls.id);
      }
      await deleteCohortLevel(confirmDeleteLevel.id);
      if (childClasses.some((c) => c.id === selectedClassId)) {
        setSelectedClassId(null);
      }
      setBannerSuccess(`Deleted level "${confirmDeleteLevel.name}".`);
      setConfirmDeleteLevel(null);
      await onRefresh();
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to delete level');
      setConfirmDeleteLevel(null);
    }
  };

  // ---------- CLASS HANDLERS ----------
  const findMatchingCurriculumForPreset = (preset?: ClassPresetMeta): Curriculum | undefined => {
    if (
      preset &&
      (preset.key === 'upper_primary' ||
        preset.key === 'junior_school' ||
        preset.key === 'senior_school')
    ) {
      const ujsCurr = curricula.find((c) => c.id === UPPER_JUNIOR_SENIOR_CURRICULUM_ID);
      if (ujsCurr) return ujsCurr;
    }
    if (!selectedCohort) return curricula[0];
    if (preset) {
      const kw = preset.name.toLowerCase();
      const matched = curricula.find(
        (c) =>
          c.level.toLowerCase().includes(kw) ||
          c.title.toLowerCase().includes(kw) ||
          (preset.key === 'junior_school' && c.level.toLowerCase().includes('grade 7')) ||
          (preset.key === 'senior_school' && c.level.toLowerCase().includes('form'))
      );
      if (matched) return matched;
    }
    return curricula.find((c) => c.id === selectedCohort.curriculumId) || curricula[0];
  };

  const handleOpenCreateClass = (lvl: CohortLevel, preset?: ClassPresetMeta) => {
    if (!selectedCohort) return;
    setTargetLevelForClass(lvl);
    setEditingClass(null);
    const matchedCurr = findMatchingCurriculumForPreset(preset);
    const shortSuffix = Math.random().toString(36).substring(2, 4).toUpperCase();
    setClassName(preset ? preset.name : '');
    setClassCode(
      preset
        ? `${preset.shortCode}-${(lvl.code || selectedCohort.code).slice(0, 6).toUpperCase()}-${shortSuffix}`
        : `CLS-${shortSuffix}`
    );
    setClassGradeBand(preset?.gradeBand || '');
    setClassAgeBracket(preset?.ageBracket || selectedCohort.ageBracket || AGE_BRACKET_OPTIONS[2]);
    setClassDescription(
      preset
        ? `${preset.name} (${preset.gradeBand}) track inside ${lvl.name}.`
        : ''
    );
    setClassTeacherId(selectedCohort.teacherId || currentTeacherId);
    setClassCurriculumId(matchedCurr?.id || '');
    setClassCourses(buildDefaultCoursesFromCurriculum(matchedCurr));
    setNewCourseTitle('');
    setNewCourseCode('');
    setNewCourseCategory(matchedCurr?.category || 'Computing');
    setNewCourseHours('4 hrs/week');
    setNewCourseDesc('');
    setClassError(null);
    setShowClassModal(true);
  };

  const handleOpenEditClass = (cls: CohortClass, lvl: CohortLevel) => {
    setTargetLevelForClass(lvl);
    setEditingClass(cls);
    setClassName(cls.name);
    setClassCode(cls.code);
    setClassGradeBand(cls.gradeBand || '');
    setClassAgeBracket(cls.ageBracket || '');
    setClassDescription(cls.description || '');
    setClassTeacherId(cls.teacherId || selectedCohort?.teacherId || currentTeacherId);
    setClassCurriculumId(cls.curriculumId || '');
    setClassCourses((cls.coursesOffered || []).map((c) => ({ ...c })));
    setNewCourseTitle('');
    setNewCourseCode('');
    setNewCourseCategory('Computing');
    setNewCourseHours('4 hrs/week');
    setNewCourseDesc('');
    setClassError(null);
    setShowClassModal(true);
  };

  const handleQuickCreatePresetClass = async (lvl: CohortLevel, preset: ClassPresetMeta) => {
    if (!selectedCohort) return;
    setBannerError(null);
    try {
      const matchedCurr = findMatchingCurriculumForPreset(preset);
      const courses = buildDefaultCoursesFromCurriculum(matchedCurr);
      const currSnapshot = matchedCurr
        ? {
            curriculumId: matchedCurr.id,
            curriculumTitle: matchedCurr.title,
            version: matchedCurr.version || 1,
            snapshotDate: new Date().toISOString(),
            learningAreas: matchedCurr.learningAreas,
          }
        : selectedCohort.curriculumSnapshot;

      const created = await createCohortClass({
        cohortId: selectedCohort.id,
        levelId: lvl.id,
        levelName: lvl.name,
        name: preset.name,
        code: `${preset.shortCode}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`,
        description: `${preset.name} (${preset.gradeBand}) class in ${lvl.name}.`,
        gradeBand: preset.gradeBand,
        ageBracket: preset.ageBracket,
        teacherId: selectedCohort.teacherId || currentTeacherId,
        teacherName: selectedCohort.teacherName || currentTeacherName,
        curriculumId: matchedCurr?.id,
        curriculumSnapshot: currSnapshot,
        coursesOffered: courses,
        status: 'active',
      });

      try {
        await seedNovDecHolidayTimetable(
          selectedCohort,
          currentTeacherName,
          lvl.termOrSeason || 'Nov/Dec Holiday 2026',
          created
        );
      } catch (ttErr) {
        console.warn('Could not auto-seed class timetable:', ttErr);
      }

      await onRefresh();
      setSelectedClassId(created.id);
      setClassSubTab('courses');
      setBannerSuccess(
        `Added class "${created.name}" under ${lvl.name} with ${courses.length} course(s) and an initialized timetable.`
      );
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to add class preset');
    }
  };

  const applyPresetToModal = (preset: ClassPresetMeta) => {
    setClassName(preset.name);
    setClassGradeBand(preset.gradeBand);
    setClassAgeBracket(preset.ageBracket);
    if (!editingClass) {
      const suffix = Math.random().toString(36).substring(2, 4).toUpperCase();
      setClassCode(`${preset.shortCode}-${suffix}`);
      const matchedCurr = findMatchingCurriculumForPreset(preset);
      if (matchedCurr) {
        setClassCurriculumId(matchedCurr.id);
        setClassCourses(buildDefaultCoursesFromCurriculum(matchedCurr));
      }
    }
  };

  const handleAddCourseToClassList = () => {
    if (!newCourseTitle.trim()) return;
    const nextCourse: CourseOffered = {
      id: `crs_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      title: newCourseTitle.trim(),
      code:
        newCourseCode.trim().toUpperCase() ||
        `CRS-${String(classCourses.length + 1).padStart(2, '0')}`,
      category: newCourseCategory.trim() || 'Computing',
      hoursPerWeek: newCourseHours.trim() || '4 hrs/week',
      description: newCourseDesc.trim() || undefined,
      curriculumId: classCurriculumId || undefined,
    };
    setClassCourses((prev) => [...prev, nextCourse]);
    setNewCourseTitle('');
    setNewCourseCode('');
    setNewCourseDesc('');
  };

  const handleSyncCoursesFromCurriculum = (currId: string) => {
    setClassCurriculumId(currId);
    const chosen = curricula.find((c) => c.id === currId);
    if (chosen && classCourses.length === 0) {
      setClassCourses(buildDefaultCoursesFromCurriculum(chosen));
    }
  };

  const handleApplyOfficialTrackToClass = async (cls: CohortClass) => {
    if (!selectedCohort) return;
    const officialCurr = curricula.find((c) => c.id === UPPER_JUNIOR_SENIOR_CURRICULUM_ID);
    if (!officialCurr) {
      setBannerError('Official 6-week Upper/Junior/Senior curriculum template was not found.');
      return;
    }

    setApplyingOfficialTrack(true);
    setBannerError(null);
    try {
      const courses = buildDefaultCoursesFromCurriculum(officialCurr);
      const snapshot = {
        curriculumId: officialCurr.id,
        curriculumTitle: officialCurr.title,
        version: officialCurr.version || 1,
        snapshotDate: new Date().toISOString(),
        learningAreas: officialCurr.learningAreas,
      };

      await updateCohortClass(cls.id, {
        curriculumId: officialCurr.id,
        curriculumSnapshot: snapshot,
        coursesOffered: courses,
      });

      const lvl = selectedCohortLevels.find((l) => l.id === cls.levelId);
      await seedNovDecHolidayTimetable(
        selectedCohort,
        cls.teacherName || selectedCohort.teacherName || currentTeacherName,
        lvl?.termOrSeason || 'Nov/Dec Holiday 2026',
        {
          ...cls,
          curriculumId: officialCurr.id,
          curriculumSnapshot: snapshot,
          coursesOffered: courses,
        },
        { replaceExisting: true }
      );

      await onRefresh();
      setBannerSuccess(
        `Applied the 6-week Coding & Cloud curriculum (${courses.length} courses) and synced Weeks 1–6 timetable for "${cls.name}".`
      );
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to apply official 6-week curriculum and timetable.');
    } finally {
      setApplyingOfficialTrack(false);
    }
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCohort || !targetLevelForClass) return;
    if (!className.trim() || !classCode.trim()) {
      setClassError('Class name and code are required.');
      return;
    }

    setSavingClass(true);
    setClassError(null);
    try {
      const chosenCurr = curricula.find((c) => c.id === classCurriculumId);
      const currChanged = !editingClass || editingClass.curriculumId !== classCurriculumId;
      const curriculumSnapshot =
        chosenCurr && currChanged
          ? {
              curriculumId: chosenCurr.id,
              curriculumTitle: chosenCurr.title,
              version: chosenCurr.version || 1,
              snapshotDate: new Date().toISOString(),
              learningAreas: chosenCurr.learningAreas,
            }
          : editingClass?.curriculumSnapshot || selectedCohort.curriculumSnapshot;

      const selectedTeacher = teachers.find((t) => t.uid === classTeacherId);
      const teacherIdToSave = selectedTeacher?.uid || classTeacherId || currentTeacherId;
      const teacherNameToSave =
        selectedTeacher?.fullName ||
        (teacherIdToSave === currentTeacherId ? currentTeacherName : selectedCohort.teacherName);

      if (editingClass) {
        await updateCohortClass(editingClass.id, {
          name: className.trim(),
          code: classCode.trim().toUpperCase(),
          description: classDescription.trim() || undefined,
          gradeBand: classGradeBand.trim() || undefined,
          ageBracket: classAgeBracket.trim() || undefined,
          teacherId: teacherIdToSave,
          teacherName: teacherNameToSave,
          curriculumId: classCurriculumId || undefined,
          ...(curriculumSnapshot ? { curriculumSnapshot } : {}),
          coursesOffered: classCourses,
        });
        setBannerSuccess(`Updated class "${className.trim()}" and its courses offered.`);
      } else {
        const created = await createCohortClass({
          cohortId: selectedCohort.id,
          levelId: targetLevelForClass.id,
          levelName: targetLevelForClass.name,
          name: className.trim(),
          code: classCode.trim().toUpperCase(),
          description: classDescription.trim() || undefined,
          gradeBand: classGradeBand.trim() || undefined,
          ageBracket: classAgeBracket.trim() || undefined,
          teacherId: teacherIdToSave,
          teacherName: teacherNameToSave,
          curriculumId: classCurriculumId || undefined,
          curriculumSnapshot,
          coursesOffered: classCourses,
          status: 'active',
        });

        try {
          await seedNovDecHolidayTimetable(
            selectedCohort,
            teacherNameToSave,
            targetLevelForClass.termOrSeason || 'Nov/Dec Holiday 2026',
            created
          );
        } catch (ttErr) {
          console.warn('Could not auto-seed class timetable:', ttErr);
        }
        setSelectedClassId(created.id);
        setClassSubTab('courses');
        setBannerSuccess(`Created class "${created.name}" under ${targetLevelForClass.name}.`);
      }

      await onRefresh();
      setShowClassModal(false);
    } catch (err: any) {
      setClassError(err?.message || 'Error saving class');
    } finally {
      setSavingClass(false);
    }
  };

  const handleConfirmDeleteClass = async () => {
    if (!confirmDeleteClass) return;
    setBannerError(null);
    try {
      await deleteCohortClass(confirmDeleteClass.id);
      if (selectedClassId === confirmDeleteClass.id) {
        setSelectedClassId(null);
      }
      setBannerSuccess(`Deleted class "${confirmDeleteClass.name}".`);
      setConfirmDeleteClass(null);
      await onRefresh();
    } catch (err: any) {
      setBannerError(err?.message || 'Failed to delete class');
      setConfirmDeleteClass(null);
    }
  };

  // ---------- LEARNER ENROLLMENT HANDLERS ----------
  const openEnrollLearnerModal = (preselectedClass?: CohortClass) => {
    if (!selectedCohort) return;
    const cohortClassesList = cohortClasses.filter((c) => c.cohortId === selectedCohort.id);
    setEnrollTargetClassId(preselectedClass?.id || selectedClassId || cohortClassesList[0]?.id || '');
    setSelectedLearnerToAdd('');
    setShowAddLearnerModal(true);
  };

  const handleAddLearner = async () => {
    if (!selectedCohort || !selectedLearnerToAdd) return;
    const learner = allLearners.find((l) => l.id === selectedLearnerToAdd);
    if (!learner) return;

    const chosenClass = cohortClasses.find((c) => c.id === enrollTargetClassId);
    const chosenLevel = chosenClass
      ? cohortLevels.find((l) => l.id === chosenClass.levelId)
      : undefined;

    setBannerError(null);
    try {
      await assignLearnerToCohort(
        selectedCohort.id,
        learner,
        chosenClass
          ? {
              levelId: chosenLevel?.id || chosenClass.levelId,
              levelName: chosenLevel?.name || chosenClass.levelName,
              classId: chosenClass.id,
              className: chosenClass.name,
              gradeBand: chosenClass.gradeBand,
            }
          : undefined
      );
      await onRefresh();
      setShowAddLearnerModal(false);
      setSelectedLearnerToAdd('');
      setBannerSuccess(
        `Enrolled ${learner.fullName} into ${selectedCohort.name}${
          chosenClass ? ` → ${chosenClass.name} (with ${chosenClass.coursesOffered?.length || 0} courses & class timetable)` : ''
        }.`
      );
    } catch (err: any) {
      setBannerError(err.message || 'Error assigning learner');
    }
  };

  const handleConfirmRemoveLearner = async () => {
    if (!selectedCohort || !confirmRemoveLearner) return;
    setRemovingLearner(true);
    setBannerError(null);
    try {
      await removeLearnerFromCohort(selectedCohort.id, confirmRemoveLearner.id);
      await onRefresh();
      setConfirmRemoveLearner(null);
    } catch (err: any) {
      setBannerError(err.message || 'Error removing learner from cohort');
    } finally {
      setRemovingLearner(false);
    }
  };

  const selectedCohortLevels = useMemo(
    () => (selectedCohort ? cohortLevels.filter((l) => l.cohortId === selectedCohort.id) : []),
    [cohortLevels, selectedCohort]
  );

  const selectedCohortClasses = useMemo(
    () => (selectedCohort ? cohortClasses.filter((c) => c.cohortId === selectedCohort.id) : []),
    [cohortClasses, selectedCohort]
  );

  const selectedClass = useMemo(
    () => selectedCohortClasses.find((c) => c.id === selectedClassId) || null,
    [selectedCohortClasses, selectedClassId]
  );

  const selectedClassLevel = useMemo(
    () =>
      selectedClass
        ? selectedCohortLevels.find((l) => l.id === selectedClass.levelId)
        : undefined,
    [selectedClass, selectedCohortLevels]
  );

  // Find enrolled learners in currently selected cohort
  const enrolledLearners = selectedCohort
    ? allLearners.filter((l) => (l.assignedCohortIds || []).includes(selectedCohort.id))
    : [];

  const learnersEligibleForModal = selectedCohort
    ? allLearners.filter((l) => {
        if (enrollTargetClassId) {
          return (
            l.classId !== enrollTargetClassId &&
            !(l.assignedClassIds || []).includes(enrollTargetClassId)
          );
        }
        return !(l.assignedCohortIds || []).includes(selectedCohort.id);
      })
    : [];

  const cohortRegisters = selectedCohort
    ? registers.filter((r) => r.cohortId === selectedCohort.id)
    : [];

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Cohort Management
          </h2>
          <p className="text-sm text-slate-500">
            Organise independent learner classes, assign immutable curriculum snapshots, and track progress.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-sm flex items-center space-x-2 transition shadow-xs shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Cohort</span>
        </button>
      </div>

      {bannerError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{bannerError}</span>
          </div>
          <button onClick={() => setBannerError(null)} className="text-rose-500 hover:text-rose-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {bannerSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="font-semibold">{bannerSuccess}</span>
          </div>
          <button onClick={() => setBannerSuccess(null)} className="text-emerald-700 hover:text-emerald-950">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Status Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search cohort by name or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
          />
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto">
          {(['active', 'archived', 'all'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-bold capitalize transition ${
                statusFilter === st
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Cohorts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredCohorts.length === 0 ? (
          <div className="col-span-full bg-white p-10 text-center rounded-2xl border border-slate-200 space-y-3">
            <Users className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="font-extrabold text-slate-700 text-base">No cohorts found</h3>
            <p className="text-sm text-slate-500">
              Create your first cohort to begin registering learners and assigning curricula.
            </p>
            <button
              onClick={handleOpenCreate}
              className="py-2 px-4 bg-emerald-700 text-white rounded-xl text-sm font-bold inline-flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Create Cohort Now</span>
            </button>
          </div>
        ) : (
          filteredCohorts.map((cohort) => {
            const count = allLearners.filter((l) =>
              (l.assignedCohortIds || []).includes(cohort.id)
            ).length;
            const lvlCount = cohortLevels.filter((l) => l.cohortId === cohort.id).length;
            const clsCount = cohortClasses.filter((c) => c.cohortId === cohort.id).length;

            return (
              <div
                key={cohort.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-emerald-300 transition-all flex flex-col justify-between p-5 space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="px-2 py-0.5 text-xs font-black uppercase tracking-wider rounded-md bg-emerald-100 text-emerald-800">
                        {cohort.code}
                      </span>
                      <h3 className="font-extrabold text-slate-900 text-base mt-1.5 leading-snug">
                        {cohort.name}
                      </h3>
                    </div>

                    <span
                      className={`text-xs font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        cohort.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {cohort.status}
                    </span>
                  </div>

                  <p className="text-sm text-slate-600 line-clamp-2">{cohort.description}</p>

                  <div className="pt-2 text-sm space-y-1.5 text-slate-500">
                    <div className="flex items-center justify-between">
                      <span>Programme:</span>
                      <strong className="text-slate-800">{cohort.programme}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Levels & Classes:</span>
                      <strong className="text-teal-800">
                        {lvlCount} Level{lvlCount === 1 ? '' : 's'} • {clsCount} Class{clsCount === 1 ? '' : 'es'}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Teacher:</span>
                      <strong className="text-slate-800 truncate max-w-[160px]">{cohort.teacherName}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Assigned Curriculum:</span>
                      <strong className="text-emerald-700 truncate max-w-[160px]">
                        {cohort.curriculumSnapshot?.curriculumTitle || 'Standard Curriculum'}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Learners Enrolled:</span>
                      <strong className="text-blue-700">{count} Learners</strong>
                    </div>
                  </div>
                </div>

                {/* Cohort Action Buttons */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => {
                        setSelectedCohort(cohort);
                        const firstCls = cohortClasses.find((c) => c.cohortId === cohort.id);
                        setSelectedClassId(firstCls?.id || null);
                        setDrawerTab('structure');
                      }}
                      className="py-1.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold transition flex items-center space-x-1"
                    >
                      <span>Levels & Classes</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setSelectedCohort(cohort);
                        setSelectedClassId(null);
                        setDrawerTab('timetable');
                      }}
                      className="py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-sm font-bold transition flex items-center space-x-1"
                      title="Open cohort weekly timetable and topics taught"
                    >
                      <CalendarDays className="w-4 h-4" />
                      <span>Timetable</span>
                    </button>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handleOpenEdit(cohort)}
                      title="Edit Cohort"
                      className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleArchiveToggle(cohort)}
                      title={cohort.status === 'archived' ? 'Unarchive' : 'Archive Cohort'}
                      className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteCohort(cohort)}
                      title="Delete Cohort"
                      className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Cohort Detail Drawer with Levels/Classes, Learners, Timetable, Curriculum & Analytics tabs */}
      {selectedCohort && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 text-xs font-black rounded-md bg-emerald-100 text-emerald-800">
                  {selectedCohort.code}
                </span>
                <h3 className="text-lg font-black text-slate-900">{selectedCohort.name}</h3>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Programme: <strong>{selectedCohort.programme}</strong>
                {selectedCohort.ageBracket ? (
                  <>
                    {' '}• Age Bracket: <strong>{selectedCohort.ageBracket}</strong>
                  </>
                ) : null}
                {' '}• Teacher: <strong>{selectedCohort.teacherName}</strong> • {selectedCohortLevels.length} Level(s) • {selectedCohortClasses.length} Class(es) • {enrolledLearners.length} Enrolled Learners
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => openEnrollLearnerModal()}
                className="py-2 px-3.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-bold flex items-center space-x-1.5 transition"
              >
                <UserPlus className="w-4 h-4" />
                <span>Enroll Learner</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteCohort(selectedCohort)}
                title="Delete Cohort"
                className="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-sm font-bold flex items-center space-x-1.5 transition"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Delete</span>
              </button>
              <button
                onClick={() => setSelectedCohort(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Drawer Tabs */}
          <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">
            <button
              onClick={() => setDrawerTab('structure')}
              className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center space-x-1.5 ${
                drawerTab === 'structure' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <FolderKanban className="w-4 h-4" />
              <span>
                Levels, Classes & Courses ({selectedCohortLevels.length} / {selectedCohortClasses.length})
              </span>
            </button>
            <button
              onClick={() => setDrawerTab('learners')}
              className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center space-x-1.5 ${
                drawerTab === 'learners' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Enrolled Learners ({enrolledLearners.length})</span>
            </button>
            <button
              onClick={() => setDrawerTab('timetable')}
              className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center space-x-1.5 ${
                drawerTab === 'timetable' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <CalendarDays className="w-4 h-4" />
              <span>Weekly Timetable & Topics Taught</span>
            </button>
            <button
              onClick={() => setDrawerTab('curriculum')}
              className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center space-x-1.5 ${
                drawerTab === 'curriculum' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Curriculum Snapshot</span>
            </button>
            <button
              onClick={() => setDrawerTab('analytics')}
              className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center space-x-1.5 ${
                drawerTab === 'analytics' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
              <span>Attendance & Summary ({cohortRegisters.length})</span>
            </button>
          </div>

          {/* TAB 0: LEVELS, CLASSES & COURSES WORKSPACE */}
          {drawerTab === 'structure' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div>
                  <h4 className="text-base font-extrabold text-slate-900 flex items-center space-x-1.5">
                    <Layers className="w-4 h-4 text-emerald-700" />
                    <span>Cohort Levels & Classes Hierarchy</span>
                  </h4>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Create a training Level (e.g., <strong>August Holiday Bootcamp Training</strong>), then add Classes (e.g., <strong>Lower Primary, Upper Primary, Junior School, Senior School</strong>) with their own Courses Offered and Timetable.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenCreateLevel}
                  className="py-2 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-sm flex items-center space-x-1.5 shadow-xs shrink-0 transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Level</span>
                </button>
              </div>

              {selectedCohortLevels.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-2xl space-y-3">
                  <Layers className="w-10 h-10 text-slate-300 mx-auto" />
                  <h4 className="text-base font-extrabold text-slate-800">
                    No Levels Created Inside {selectedCohort.name} Yet
                  </h4>
                  <p className="text-sm text-slate-500 max-w-md mx-auto">
                    Start by creating a Level such as "August Holiday Bootcamp Training", then create classes like Lower Primary, Upper Primary, Junior School, or Senior School.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenCreateLevel}
                    className="py-2 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-sm inline-flex items-center space-x-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create First Level</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedCohortLevels.map((lvl) => {
                    const lvlClasses = selectedCohortClasses.filter((c) => c.levelId === lvl.id);
                    return (
                      <div
                        key={lvl.id}
                        className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs"
                      >
                        {/* Level Header */}
                        <div className="bg-slate-50 border-b border-slate-200 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              {lvl.code && (
                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono font-black text-xs uppercase">
                                  {lvl.code}
                                </span>
                              )}
                              <h5 className="text-base font-black text-slate-900">{lvl.name}</h5>
                              {lvl.termOrSeason && (
                                <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-bold">
                                  {lvl.termOrSeason}
                                </span>
                              )}
                              {lvl.startDate && lvl.endDate && (
                                <span className="text-xs text-slate-500 font-medium">
                                  {lvl.startDate} to {lvl.endDate}
                                </span>
                              )}
                            </div>
                            {lvl.description && (
                              <p className="text-sm text-slate-500 mt-1">{lvl.description}</p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenCreateClass(lvl)}
                              className="py-1.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-bold flex items-center space-x-1 transition"
                            >
                              <Plus className="w-4 h-4" />
                              <span>Add Class</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditLevel(lvl)}
                              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg"
                              title="Edit Level"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteLevel(lvl)}
                              className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                              title="Delete Level"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Quick-Add Presets Bar */}
                        <div className="px-4 py-2.5 bg-emerald-50/40 border-b border-slate-100 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-bold text-slate-600 mr-1">Quick-Add Class:</span>
                          {CLASS_LEVEL_PRESETS.map((preset) => {
                            const exists = lvlClasses.some(
                              (c) => c.name.toLowerCase() === preset.name.toLowerCase()
                            );
                            return (
                              <button
                                key={preset.key}
                                type="button"
                                onClick={() => handleQuickCreatePresetClass(lvl, preset)}
                                disabled={exists}
                                className={`px-2.5 py-1 rounded-lg font-bold border transition flex items-center space-x-1 ${
                                  exists
                                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-default'
                                    : 'bg-white hover:bg-emerald-100 text-emerald-900 border-emerald-200'
                                }`}
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>{preset.name}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Classes Grid inside Level */}
                        <div className="p-4">
                          {lvlClasses.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-4">
                              No classes in this level yet. Use a quick-add button above or click "Add Class".
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                              {lvlClasses.map((cls) => {
                                const isSelected = selectedClassId === cls.id;
                                const studentCount = allLearners.filter(
                                  (l) =>
                                    l.classId === cls.id ||
                                    (l.assignedClassIds || []).includes(cls.id)
                                ).length;
                                return (
                                  <div
                                    key={cls.id}
                                    onClick={() => {
                                      setSelectedClassId(cls.id);
                                      setClassSubTab('courses');
                                    }}
                                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between space-y-2.5 ${
                                      isSelected
                                        ? 'border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-500/20 shadow-xs'
                                        : 'border-slate-200 hover:border-emerald-300 bg-white'
                                    }`}
                                  >
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-xs font-black">
                                          {cls.code}
                                        </span>
                                        <div className="flex items-center space-x-1">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenEditClass(cls, lvl);
                                            }}
                                            className="p-1 text-slate-500 hover:text-slate-900 rounded"
                                            title="Edit Class & Courses"
                                          >
                                            <Edit2 className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setConfirmDeleteClass(cls);
                                            }}
                                            className="p-1 text-slate-400 hover:text-rose-700 rounded"
                                            title="Delete Class"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                      <h6 className="font-extrabold text-slate-900 text-base">
                                        {cls.name}
                                      </h6>
                                      {cls.gradeBand && (
                                        <p className="text-xs text-slate-500 font-medium">
                                          {cls.gradeBand}
                                        </p>
                                      )}
                                    </div>

                                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-bold">
                                      <span className="text-emerald-800">
                                        {cls.coursesOffered?.length || 0} Courses
                                      </span>
                                      <span className="text-blue-700">
                                        {studentCount} Student{studentCount === 1 ? '' : 's'}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Selected Class Workspace */}
              {selectedClass && (
                <div className="border-2 border-emerald-200 rounded-2xl bg-white shadow-sm overflow-hidden">
                  <div className="bg-gradient-to-r from-emerald-800 to-teal-800 p-4 sm:p-5 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider bg-white/15 px-2.5 py-0.5 rounded-full">
                        {selectedClassLevel?.name || selectedClass.levelName} • {selectedClass.code}
                      </span>
                      <h4 className="text-lg font-black mt-1">
                        {selectedClass.name} Workspace
                      </h4>
                      <p className="text-sm text-emerald-100">
                        {selectedClass.gradeBand ? `${selectedClass.gradeBand} • ` : ''}
                        Teacher: {selectedClass.teacherName || selectedCohort.teacherName} •{' '}
                        {selectedClass.coursesOffered?.length || 0} Courses Offered
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedClassLevel && (
                        <button
                          type="button"
                          onClick={() => handleOpenEditClass(selectedClass, selectedClassLevel)}
                          className="py-1.5 px-3 bg-white text-emerald-950 font-bold rounded-xl text-sm flex items-center space-x-1.5 hover:bg-emerald-50"
                        >
                          <Edit2 className="w-4 h-4" />
                          <span>Edit Class & Courses</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEnrollLearnerModal(selectedClass)}
                        className="py-1.5 px-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-xl text-sm flex items-center space-x-1.5"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Enroll Student Here</span>
                      </button>
                    </div>
                  </div>

                  {/* Class Workspace Sub-Tabs */}
                  <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setClassSubTab('courses')}
                      className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center space-x-1.5 ${
                        classSubTab === 'courses'
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-700 border border-slate-200'
                      }`}
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>Courses Offered ({selectedClass.coursesOffered?.length || 0})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setClassSubTab('timetable')}
                      className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center space-x-1.5 ${
                        classSubTab === 'timetable'
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-700 border border-slate-200'
                      }`}
                    >
                      <CalendarDays className="w-4 h-4" />
                      <span>Class Timetable & What Is Taught</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setClassSubTab('students')}
                      className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center space-x-1.5 ${
                        classSubTab === 'students'
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-700 border border-slate-200'
                      }`}
                    >
                      <GraduationCap className="w-4 h-4" />
                      <span>
                        Class Students (
                        {
                          allLearners.filter(
                            (l) =>
                              l.classId === selectedClass.id ||
                              (l.assignedClassIds || []).includes(selectedClass.id)
                          ).length
                        }
                        )
                      </span>
                    </button>
                  </div>

                  <div className="p-5">
                    {classSubTab === 'courses' && (
                      <div className="space-y-4">
                        {isUpperJuniorSeniorTrack(selectedClass, selectedCohort) &&
                          selectedClass.curriculumId !== UPPER_JUNIOR_SENIOR_CURRICULUM_ID && (
                            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="text-sm text-blue-950 space-y-0.5">
                                <p className="font-extrabold flex items-center space-x-1.5">
                                  <Sparkles className="w-4 h-4 text-blue-700 shrink-0" />
                                  <span>Official 6-Week Upper Primary / Junior / Senior Curriculum Ready</span>
                                </p>
                                <p className="text-blue-800">
                                  Apply the 6 courses (Office &amp; MS Azure, AI &amp; C, C++ &amp; Arduino, DBMS, Python/Java/JS, Libraries &amp; Projects) and Nov 2 – Dec 11 timetable to {selectedClass.name}.
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={applyingOfficialTrack}
                                onClick={() => handleApplyOfficialTrackToClass(selectedClass)}
                                className="py-2 px-4 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-bold shrink-0 transition"
                              >
                                {applyingOfficialTrack ? 'Applying...' : 'Apply 6-Week Curriculum & Timetable'}
                              </button>
                            </div>
                          )}

                        {(selectedClass.coursesOffered || []).length === 0 ? (
                          <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-sm text-slate-500 space-y-2">
                            <p>No courses added to {selectedClass.name} yet.</p>
                            {selectedClassLevel && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditClass(selectedClass, selectedClassLevel)}
                                className="py-2 px-4 bg-emerald-700 text-white rounded-lg text-sm font-bold"
                              >
                                Add Courses Offered
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {selectedClass.coursesOffered.map((course) => (
                              <div
                                key={course.id}
                                className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-xs font-bold">
                                    {course.code || 'COURSE'}
                                  </span>
                                  {course.hoursPerWeek && (
                                    <span className="text-xs font-semibold text-slate-500 flex items-center space-x-1">
                                      <Clock className="w-3.5 h-3.5" />
                                      <span>{course.hoursPerWeek}</span>
                                    </span>
                                  )}
                                </div>
                                <h5 className="font-extrabold text-slate-900 text-base">
                                  {course.title}
                                </h5>
                                {course.category && (
                                  <p className="text-xs font-semibold text-blue-800">
                                    {course.category}
                                  </p>
                                )}
                                {course.description && (
                                  <p className="text-sm text-slate-600">{course.description}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {selectedClass.curriculumSnapshot && (
                          <div className="pt-3 border-t border-slate-100 space-y-2">
                            <p className="text-sm font-extrabold text-slate-800">
                              Bound Curriculum Blueprint: {selectedClass.curriculumSnapshot.curriculumTitle} (v
                              {selectedClass.curriculumSnapshot.version})
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {selectedClass.curriculumSnapshot.learningAreas.map((la) => (
                                <div
                                  key={la.id}
                                  className="p-3 rounded-xl border border-slate-200 bg-white text-sm"
                                >
                                  <strong className="text-slate-900">{la.title}</strong>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {la.modules.length} module(s) •{' '}
                                    {la.modules.reduce((acc, m) => acc + m.topics.length, 0)} topic(s)
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {classSubTab === 'timetable' && (
                      <WeeklyTimetableView
                        cohorts={cohorts}
                        cohortLevels={cohortLevels}
                        cohortClasses={cohortClasses}
                        learners={allLearners}
                        fixedCohortId={selectedCohort.id}
                        fixedLevel={selectedClassLevel}
                        fixedClass={selectedClass}
                        currentTeacherName={currentTeacherName}
                        registers={registers}
                        embedded
                      />
                    )}

                    {classSubTab === 'students' && (() => {
                      const classStudents = allLearners.filter(
                        (l) =>
                          l.classId === selectedClass.id ||
                          (l.assignedClassIds || []).includes(selectedClass.id)
                      );
                      return classStudents.length === 0 ? (
                        <div className="p-8 text-center bg-slate-50 rounded-xl text-sm text-slate-500 space-y-2">
                          <p>No students enrolled in {selectedClass.name} yet.</p>
                          <button
                            type="button"
                            onClick={() => openEnrollLearnerModal(selectedClass)}
                            className="py-2 px-4 bg-blue-700 text-white rounded-xl text-sm font-bold inline-flex items-center space-x-1.5"
                          >
                            <UserPlus className="w-4 h-4" />
                            <span>Enroll Student into {selectedClass.name}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-slate-200 rounded-xl">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-bold">
                              <tr>
                                <th className="py-3 px-4">#</th>
                                <th className="py-3 px-4">Student Name</th>
                                <th className="py-3 px-4">Digital ID</th>
                                <th className="py-3 px-4">Grade</th>
                                <th className="py-3 px-4">Courses & Timetable</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {classStudents.map((lr, idx) => (
                                <tr key={lr.id} className="hover:bg-slate-50/70">
                                  <td className="py-3 px-4 text-slate-400">{idx + 1}</td>
                                  <td className="py-3 px-4 font-bold text-slate-900">{lr.fullName}</td>
                                  <td className="py-3 px-4 font-mono text-blue-700">
                                    {lr.digitalId || lr.learnerId}
                                  </td>
                                  <td className="py-3 px-4">{lr.grade || selectedClass.gradeBand || '—'}</td>
                                  <td className="py-3 px-4">
                                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs">
                                      {selectedClass.coursesOffered?.length || 0} Courses • Class Timetable Active
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 1: LEARNERS */}
          {drawerTab === 'learners' && (
            <div className="space-y-3">
              {enrolledLearners.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500 bg-slate-50 rounded-xl">
                  No learners enrolled in this cohort yet. Click "Enroll Learner" or import learners via Learner Management.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-bold">
                      <tr>
                        <th className="py-3 px-4">#</th>
                        <th className="py-3 px-4">Learner Name</th>
                        <th className="py-3 px-4">Digital ID</th>
                        <th className="py-3 px-4">Level & Class</th>
                        <th className="py-3 px-4">Guardian Contact</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {enrolledLearners.map((lr, idx) => (
                        <tr key={lr.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 text-slate-400">{idx + 1}</td>
                          <td className="py-3 px-4 font-bold text-slate-900">{lr.fullName}</td>
                          <td className="py-3 px-4 text-blue-700 font-mono text-xs">{lr.digitalId || lr.learnerId}</td>
                          <td className="py-3 px-4">
                            {lr.className ? (
                              <span className="px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-xs">
                                {lr.levelName ? `${lr.levelName} → ` : ''}
                                {lr.className}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">General Cohort</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-500">{lr.guardianContact || '—'}</td>
                          <td className="py-3 px-4 text-right whitespace-nowrap space-x-1">
                            <button
                              onClick={() => generateBootcampCertificatePDF(lr, selectedCohort)}
                              className="py-1.5 px-2.5 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition inline-flex items-center space-x-1 text-xs font-semibold"
                              title="Download Bootcamp Completion Certificate (PDF)"
                            >
                              <Award className="w-3.5 h-3.5 text-emerald-700" />
                              <span>Certificate</span>
                            </button>
                            <button
                              onClick={() => setConfirmRemoveLearner(lr)}
                              className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md transition inline-flex align-middle"
                              title="Remove from cohort"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: EMBEDDED WEEKLY TIMETABLE & TOPICS TAUGHT */}
          {drawerTab === 'timetable' && (
            <WeeklyTimetableView
              cohorts={cohorts}
              cohortLevels={cohortLevels}
              cohortClasses={cohortClasses}
              learners={allLearners}
              fixedCohortId={selectedCohort.id}
              currentTeacherName={currentTeacherName}
              registers={registers}
              embedded
            />
          )}

          {/* TAB 3: CURRICULUM SNAPSHOT */}
          {drawerTab === 'curriculum' && (
            <div className="space-y-3">
              {!selectedCohort.curriculumSnapshot ? (
                <div className="p-6 text-center text-sm text-slate-500 bg-slate-50 rounded-xl">
                  No curriculum snapshot bound to this cohort. Edit the cohort to assign a curriculum.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl text-sm flex flex-wrap justify-between gap-2">
                    <span className="font-bold text-emerald-950">
                      {selectedCohort.curriculumSnapshot.curriculumTitle} (Version {selectedCohort.curriculumSnapshot.version})
                    </span>
                    <span className="text-emerald-800">
                      Snapshot Frozen: {new Date(selectedCohort.curriculumSnapshot.snapshotDate).toLocaleDateString('en-KE')}
                    </span>
                  </div>
                  {selectedCohort.curriculumSnapshot.learningAreas.map((area, i) => (
                    <div key={area.id} className="border border-slate-200 rounded-xl p-4 space-y-2">
                      <h4 className="text-sm font-extrabold text-slate-900">
                        {i + 1}. {area.title}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {area.modules.map((mod) => (
                          <div key={mod.id} className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-sm">
                            <p className="font-bold text-slate-800">{mod.title}</p>
                            <p className="text-xs text-slate-500 mt-1">
                              {mod.topics.length} Topics: {mod.topics.map((t) => t.title).join(', ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ANALYTICS */}
          {drawerTab === 'analytics' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <span className="text-slate-500 block font-semibold">Total Submissions</span>
                <span className="text-2xl font-black text-slate-900">{cohortRegisters.length}</span>
              </div>
              <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200">
                <span className="text-emerald-800 block font-semibold">Present / Late</span>
                <span className="text-2xl font-black text-emerald-900">
                  {cohortRegisters.filter((r) => r.status === 'present' || r.status === 'late').length}
                </span>
              </div>
              <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-200">
                <span className="text-blue-800 block font-semibold">Verified Entries</span>
                <span className="text-2xl font-black text-blue-900">
                  {cohortRegisters.filter((r) => r.verificationStatus === 'verified').length}
                </span>
              </div>
              <div className="bg-rose-50 p-3.5 rounded-xl border border-rose-200">
                <span className="text-rose-800 block font-semibold">Needs Support</span>
                <span className="text-2xl font-black text-rose-900">
                  {cohortRegisters.filter((r) => r.understandingLevel === 'needs_support').length}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT COHORT MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-800 to-teal-800 p-5 text-white flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-base tracking-tight">
                  {editingCohort ? 'Edit Cohort' : 'Create New Cohort'}
                </h3>
                <p className="text-emerald-100 text-sm">
                  Sangurur Comprehensive School Academic Cohorts
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCohort} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {modalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
                  {modalError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Cohort Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Nov/Dec Computing Boot Camp"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Unique Cohort Code
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. COHORT-2026-A"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono uppercase focus:ring-2 focus:ring-emerald-600 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  Programme / Department
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Junior Secondary CBC, STEM Club"
                  value={programme}
                  onChange={(e) => setProgramme(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                />
              </div>

              {isAdmin && teachers.length > 0 && (
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Assigned Teacher
                  </label>
                  <select
                    value={assignedTeacherId}
                    onChange={(e) => setAssignedTeacherId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                  >
                    {teachers.map((t) => (
                      <option key={t.uid} value={t.uid}>
                        {t.fullName} ({t.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Short description of this learning class..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Learning Level
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Grade 7"
                    value={learningLevel}
                    onChange={(e) => setLearningLevel(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Age Bracket *
                  </label>
                  <input
                    type="text"
                    required
                    list="cohort-age-brackets"
                    placeholder="e.g. 13–15 Years (Junior School)"
                    value={ageBracket}
                    onChange={(e) => setAgeBracket(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                  />
                  <datalist id="cohort-age-brackets">
                    {AGE_BRACKET_OPTIONS.map((opt) => (
                      <option key={opt} value={opt} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  Assign Curriculum (Versioned Snapshot)
                </label>
                <select
                  value={selectedCurriculumId}
                  onChange={(e) => setSelectedCurriculumId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                >
                  <option value="">Select a curriculum template...</option>
                  {curricula.map((curr) => (
                    <option key={curr.id} value={curr.id}>
                      {curr.title} ({curr.category} • {curr.level})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1 italic">
                  * An immutable versioned snapshot is bound to this cohort so later edits won't alter past records.
                </p>
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="py-2 px-4 text-slate-600 hover:text-slate-800 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="py-2.5 px-5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-sm shadow-md transition"
                >
                  {submitting ? 'Saving...' : editingCohort ? 'Update Cohort' : 'Create Cohort'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ENROLL LEARNER MODAL (Cohort -> Level -> Class) */}
      {showAddLearnerModal && selectedCohort && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-blue-800 p-4 text-white flex justify-between items-center">
              <h3 className="font-extrabold text-base">
                Enroll Learner into {selectedCohort.name}
              </h3>
              <button
                onClick={() => setShowAddLearnerModal(false)}
                className="text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {selectedCohortClasses.length > 0 && (
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Assign Level & Class (Includes Full Courses & Timetable):
                  </label>
                  <select
                    value={enrollTargetClassId}
                    onChange={(e) => {
                      setEnrollTargetClassId(e.target.value);
                      setSelectedLearnerToAdd('');
                    }}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-blue-600 outline-none"
                  >
                    <option value="">General Cohort Enrollment (No Specific Class)</option>
                    {selectedCohortLevels.map((lvl) => {
                      const clsList = selectedCohortClasses.filter((c) => c.levelId === lvl.id);
                      if (clsList.length === 0) return null;
                      return (
                        <optgroup key={lvl.id} label={lvl.name}>
                          {clsList.map((cls) => (
                            <option key={cls.id} value={cls.id}>
                              {cls.name} ({cls.coursesOffered?.length || 0} Courses)
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  Select Registered Learner:
                </label>

                {learnersEligibleForModal.length === 0 ? (
                  <p className="text-sm text-slate-500 bg-slate-50 p-3 rounded-xl">
                    All registered learners are already enrolled in this selection.
                  </p>
                ) : (
                  <select
                    value={selectedLearnerToAdd}
                    onChange={(e) => setSelectedLearnerToAdd(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-600 outline-none"
                  >
                    <option value="">Choose a learner...</option>
                    {learnersEligibleForModal.map((lr) => (
                      <option key={lr.id} value={lr.id}>
                        {lr.fullName} ({lr.learnerId} - {lr.username})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddLearnerModal(false)}
                  className="py-2 px-3.5 text-sm text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedLearnerToAdd}
                  onClick={handleAddLearner}
                  className="py-2 px-4 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-xs"
                >
                  Confirm Enrollment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT LEVEL MODAL */}
      {showLevelModal && selectedCohort && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-emerald-800 p-5 text-white flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-base">
                  {editingLevel ? `Edit Level: ${editingLevel.name}` : 'Create Level Inside Cohort'}
                </h3>
                <p className="text-sm text-emerald-100">
                  Cohort: {selectedCohort.name} ({selectedCohort.code})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLevelModal(false)}
                className="text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveLevel} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
              {levelError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
                  {levelError}
                </div>
              )}

              <div>
                <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Quick Suggestions:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {LEVEL_NAME_SUGGESTIONS.map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setLevelName(sug)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-900 text-xs font-semibold transition"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Level Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. August Holiday Bootcamp Training"
                    value={levelName}
                    onChange={(e) => setLevelName(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Level Code
                  </label>
                  <input
                    type="text"
                    placeholder="AUG-2026"
                    value={levelCode}
                    onChange={(e) => setLevelCode(e.target.value.toUpperCase())}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono uppercase focus:ring-2 focus:ring-emerald-600 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  Term / Bootcamp Season
                </label>
                <input
                  type="text"
                  placeholder="e.g. August Holiday 2026"
                  value={levelTerm}
                  onChange={(e) => setLevelTerm(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-600 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={levelStartDate}
                    onChange={(e) => setLevelStartDate(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={levelEndDate}
                    onChange={(e) => setLevelEndDate(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={levelDescription}
                  onChange={(e) => setLevelDescription(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLevelModal(false)}
                  className="py-2 px-4 text-sm text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLevel}
                  className="py-2.5 px-5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl text-sm"
                >
                  {savingLevel ? 'Saving...' : editingLevel ? 'Update Level' : 'Create Level'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE / EDIT CLASS & COURSES MODAL */}
      {showClassModal && selectedCohort && targetLevelForClass && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            <div className="bg-emerald-800 p-5 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-extrabold text-base">
                  {editingClass ? `Edit Class: ${editingClass.name}` : 'Create Class & Courses Offered'}
                </h3>
                <p className="text-sm text-emerald-100">
                  {selectedCohort.name} → {targetLevelForClass.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowClassModal(false)}
                className="text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClass} className="p-6 space-y-4 overflow-y-auto flex-1">
              {classError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
                  {classError}
                </div>
              )}

              <div>
                <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Class Tier Presets:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {CLASS_LEVEL_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => applyPresetToModal(preset)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-xs font-bold transition"
                    >
                      {preset.name} ({preset.gradeBand})
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Class Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Lower Primary, Upper Primary, Junior School, Senior School"
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Class Code *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="LP-AUG-01"
                    value={classCode}
                    onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm font-mono uppercase outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Grade Band</label>
                  <input
                    type="text"
                    placeholder="e.g. Grade 1 – Grade 3"
                    value={classGradeBand}
                    onChange={(e) => setClassGradeBand(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Age Bracket</label>
                  <input
                    type="text"
                    list="cohort-age-brackets"
                    placeholder="e.g. 6–9 Years"
                    value={classAgeBracket}
                    onChange={(e) => setClassAgeBracket(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Curriculum Template
                  </label>
                  <select
                    value={classCurriculumId}
                    onChange={(e) => handleSyncCoursesFromCurriculum(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    <option value="">Select curriculum...</option>
                    {curricula.map((curr) => (
                      <option key={curr.id} value={curr.id}>
                        {curr.title} ({curr.level})
                      </option>
                    ))}
                  </select>
                </div>

                {teachers.length > 0 && (
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">
                      Class Facilitator / Teacher
                    </label>
                    <select
                      value={classTeacherId}
                      onChange={(e) => setClassTeacherId(e.target.value)}
                      className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      {teachers.map((t) => (
                        <option key={t.uid} value={t.uid}>
                          {t.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Courses Offered Builder */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-extrabold text-slate-900 flex items-center space-x-1.5">
                    <BookOpen className="w-4 h-4 text-emerald-700" />
                    <span>Courses Offered in This Class ({classCourses.length})</span>
                  </span>
                  {classCurriculumId && (
                    <button
                      type="button"
                      onClick={() => {
                        const chosen = curricula.find((c) => c.id === classCurriculumId);
                        if (chosen) setClassCourses(buildDefaultCoursesFromCurriculum(chosen));
                      }}
                      className="text-xs font-bold text-blue-700 hover:underline"
                    >
                      Load Learning Areas as Courses
                    </button>
                  )}
                </div>

                {classCourses.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {classCourses.map((crs, idx) => (
                      <div
                        key={crs.id}
                        className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded mr-1.5">
                            {crs.code || `CRS-${idx + 1}`}
                          </span>
                          <strong className="text-slate-900">{crs.title}</strong>
                          {crs.hoursPerWeek && (
                            <span className="text-slate-500 ml-2 text-xs">({crs.hoursPerWeek})</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setClassCourses((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-rose-600 hover:text-rose-800 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center pt-1">
                  <input
                    type="text"
                    placeholder="Course Title (e.g. Scratch Coding)"
                    value={newCourseTitle}
                    onChange={(e) => setNewCourseTitle(e.target.value)}
                    className="sm:col-span-5 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-sm outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Code (CRS-01)"
                    value={newCourseCode}
                    onChange={(e) => setNewCourseCode(e.target.value.toUpperCase())}
                    className="sm:col-span-2 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono outline-none"
                  />
                  <input
                    type="text"
                    placeholder="4 hrs/wk"
                    value={newCourseHours}
                    onChange={(e) => setNewCourseHours(e.target.value)}
                    className="sm:col-span-3 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCourseToClassList}
                    disabled={!newCourseTitle.trim()}
                    className="sm:col-span-2 py-2 px-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg text-sm font-bold"
                  >
                    + Add
                  </button>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowClassModal(false)}
                  className="py-2 px-4 text-sm text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingClass}
                  className="py-2.5 px-5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl text-sm"
                >
                  {savingClass ? 'Saving...' : editingClass ? 'Update Class' : 'Create Class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE LEVEL MODAL */}
      {confirmDeleteLevel && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-extrabold text-slate-900">Delete Level?</h3>
            <p className="text-sm text-slate-600">
              Delete <strong>{confirmDeleteLevel.name}</strong> and any classes inside it?
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteLevel(null)}
                className="py-2 px-4 text-sm text-slate-600 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteLevel}
                className="py-2 px-4 bg-rose-700 hover:bg-rose-800 text-white font-bold rounded-xl text-sm"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE CLASS MODAL */}
      {confirmDeleteClass && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-extrabold text-slate-900">Delete Class?</h3>
            <p className="text-sm text-slate-600">
              Delete <strong>{confirmDeleteClass.name}</strong> ({confirmDeleteClass.code})?
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteClass(null)}
                className="py-2 px-4 text-sm text-slate-600 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteClass}
                className="py-2 px-4 bg-rose-700 hover:bg-rose-800 text-white font-bold rounded-xl text-sm"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE COHORT MODAL */}
      {confirmDeleteCohort && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Delete Cohort Permanently?
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  You are about to delete <strong>{confirmDeleteCohort.name}</strong> ({confirmDeleteCohort.code}).
                </p>
              </div>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-900 space-y-1">
              <p className="font-bold">This will also remove:</p>
              <ul className="list-disc list-inside space-y-0.5 text-rose-800">
                <li>
                  {cohortLevels.filter((l) => l.cohortId === confirmDeleteCohort.id).length} level(s) &amp;{' '}
                  {cohortClasses.filter((c) => c.cohortId === confirmDeleteCohort.id).length} class(es) inside this cohort
                </li>
                <li>All weekly timetables and cohort enrollments ({allLearners.filter((l) => (l.assignedCohortIds || []).includes(confirmDeleteCohort.id)).length} learner(s) unassigned cleanly)</li>
              </ul>
              <p className="text-xs text-rose-700 pt-1">
                Historical attendance registers remain preserved for school records.
              </p>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                disabled={deletingCohort}
                onClick={() => setConfirmDeleteCohort(null)}
                className="py-2 px-4 text-sm text-slate-600 font-semibold hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingCohort}
                onClick={handleConfirmDeleteCohort}
                className="py-2 px-4 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white font-bold rounded-xl text-sm"
              >
                {deletingCohort ? 'Deleting...' : 'Delete Cohort'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM REMOVE LEARNER MODAL */}
      {confirmRemoveLearner && selectedCohort && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-base font-extrabold text-slate-900">
              Remove Learner from Cohort?
            </h3>
            <p className="text-sm text-slate-600">
              Remove <strong>{confirmRemoveLearner.fullName}</strong> ({confirmRemoveLearner.learnerId}) from{' '}
              <strong>{selectedCohort.name}</strong>? Historical attendance logs remain preserved.
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveLearner(null)}
                className="py-2 px-4 text-sm text-slate-600 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removingLearner}
                onClick={handleConfirmRemoveLearner}
                className="py-2 px-4 bg-rose-700 hover:bg-rose-800 text-white font-bold rounded-xl text-sm"
              >
                {removingLearner ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
