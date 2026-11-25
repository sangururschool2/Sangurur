import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Cohort, CohortLevel, CohortClass } from '../../types';
import {
  Users,
  BookOpen,
  CheckCircle,
  ArrowRight,
  AlertCircle,
  Loader2,
  X,
  LogOut,
  Layers,
} from 'lucide-react';

interface CohortSelectModalProps {
  onSelected: (cohort: Cohort, selectedClass?: CohortClass | null) => void;
  onClose?: () => void;
}

export const CohortSelectModal: React.FC<CohortSelectModalProps> = ({ onSelected, onClose }) => {
  const { learnerProfile, learnerToken, logout } = useAuth();
  const [assignedCohorts, setAssignedCohorts] = useState<Cohort[]>([]);
  const [assignedLevels, setAssignedLevels] = useState<CohortLevel[]>([]);
  const [assignedClasses, setAssignedClasses] = useState<CohortClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCohort, setSelectedCohort] = useState<Cohort | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string>('');

  const resolveDefaultClassForCohort = (cohort: Cohort, classesList: CohortClass[]) => {
    const inCohort = classesList.filter((c) => c.cohortId === cohort.id);
    if (inCohort.length === 0) return null;
    if (learnerProfile?.classId) {
      const exact = inCohort.find((c) => c.id === learnerProfile.classId);
      if (exact) return exact;
    }
    if (learnerProfile?.assignedClassIds?.length) {
      const byList = inCohort.find((c) => learnerProfile.assignedClassIds!.includes(c.id));
      if (byList) return byList;
    }
    return inCohort[0];
  };

  useEffect(() => {
    async function loadAssigned() {
      if (!learnerProfile || !learnerToken) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/learner/cohorts', {
          headers: { Authorization: `Bearer ${learnerToken}` },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Could not load your assigned cohorts.');
        }

        const list: Cohort[] = data.cohorts || [];
        const levels: CohortLevel[] = data.levels || [];
        const classes: CohortClass[] = data.classes || [];
        setAssignedCohorts(list);
        setAssignedLevels(levels);
        setAssignedClasses(classes);

        if (list.length > 0) {
          const activeFirst = list.find((c) => c.status === 'active') || list[0];
          setSelectedCohort(activeFirst);
          const defaultCls = resolveDefaultClassForCohort(activeFirst, classes);
          setSelectedClassId(defaultCls?.id || '');
        }
      } catch (err: any) {
        setError(err.message || 'Error loading assigned cohorts');
      } finally {
        setLoading(false);
      }
    }
    loadAssigned();
  }, [learnerProfile, learnerToken]);

  const handleConfirm = () => {
    if (selectedCohort) {
      const chosenClass =
        assignedClasses.find((c) => c.id === selectedClassId && c.cohortId === selectedCohort.id) ||
        resolveDefaultClassForCohort(selectedCohort, assignedClasses);
      onSelected(selectedCohort, chosenClass);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-blue-800 p-5 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Users className="w-6 h-6 text-emerald-200" />
            </div>
            <div>
              <h3 className="font-extrabold text-lg tracking-tight">
                Select Your Assigned Cohort & Class
              </h3>
              <p className="text-emerald-100 text-sm">
                Sangurur Digital Learner Register (SDLR)
              </p>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
              aria-label="Close cohort selector"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-6 space-y-4">
          <div className="text-sm text-slate-600">
            Welcome back, <strong className="text-slate-900">{learnerProfile?.fullName}</strong>. Please confirm the cohort and class you are registering for today:
          </div>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center text-slate-500 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="text-sm">Finding your assigned class records...</span>
            </div>
          ) : assignedCohorts.length === 0 ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start space-x-3 text-sm text-amber-800">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">No assigned cohorts found</p>
                <p className="mt-1">
                  Your account is active, but your teacher has not yet enrolled you into a cohort. Please contact your class teacher so they can assign your class.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {assignedCohorts.map((cohort) => {
                const isSelected = selectedCohort?.id === cohort.id;
                const classesInCohort = assignedClasses.filter((c) => c.cohortId === cohort.id);
                const activeCls =
                  (isSelected
                    ? classesInCohort.find((c) => c.id === selectedClassId)
                    : null) || resolveDefaultClassForCohort(cohort, assignedClasses);
                const activeLvl = activeCls
                  ? assignedLevels.find((l) => l.id === activeCls.levelId)
                  : undefined;

                return (
                  <div
                    key={cohort.id}
                    onClick={() => {
                      setSelectedCohort(cohort);
                      const defCls = resolveDefaultClassForCohort(cohort, assignedClasses);
                      setSelectedClassId(defCls?.id || '');
                    }}
                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all space-y-2 ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-500'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 text-base">
                            {cohort.name}
                          </span>
                          <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                            {cohort.code}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">{cohort.programme} • {cohort.learningLevel}</p>

                        {activeCls && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-bold text-xs inline-flex items-center space-x-1">
                              <Layers className="w-3.5 h-3.5" />
                              <span>
                                {activeLvl?.name || activeCls.levelName} → {activeCls.name}
                              </span>
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold text-xs">
                              {activeCls.coursesOffered?.length || 0} Courses Offered
                            </span>
                          </div>
                        )}

                        <p className="text-xs text-emerald-800 font-medium flex items-center space-x-1">
                          <BookOpen className="w-3.5 h-3.5 inline mr-1 text-emerald-600 shrink-0" />
                          <span>
                            Curriculum:{' '}
                            {activeCls?.curriculumSnapshot?.curriculumTitle ||
                              cohort.curriculumSnapshot?.curriculumTitle ||
                              'Standard Curriculum'}
                          </span>
                        </p>
                      </div>

                      <div className="shrink-0 mt-1">
                        {isSelected ? (
                          <CheckCircle className="w-5 h-5 text-emerald-600" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-slate-300" />
                        )}
                      </div>
                    </div>

                    {isSelected && classesInCohort.length > 1 && (
                      <div
                        className="pt-2 border-t border-emerald-200/70"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <label className="block text-xs font-bold uppercase tracking-wider text-emerald-900 mb-1">
                          Class Stream:
                        </label>
                        <select
                          value={selectedClassId}
                          onChange={(e) => setSelectedClassId(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-sm font-semibold text-slate-800 outline-none"
                        >
                          {classesInCohort.map((cls) => (
                            <option key={cls.id} value={cls.id}>
                              {cls.levelName} → {cls.name} ({cls.coursesOffered?.length || 0} Courses)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={logout}
              className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm flex items-center space-x-1.5 transition"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>

            <button
              type="button"
              disabled={!selectedCohort || loading}
              onClick={handleConfirm}
              className="flex-1 py-3 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 text-base"
            >
              <span>Confirm & Enter Register</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
