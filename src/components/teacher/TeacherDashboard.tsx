import React, { useMemo, useState } from 'react';
import {
  Cohort,
  CohortLevel,
  CohortClass,
  Learner,
  DailyRegister,
  UnderstandingLevel,
  EDUCATION_LEVEL_BANDS,
  classifyEducationLevel,
} from '../../types';
import { TeacherTab } from '../common/Sidebar';
import {
  Users,
  UserCheck,
  Clock,
  UserX,
  ShieldAlert,
  ClipboardList,
  ArrowUpRight,
  PlusCircle,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  GraduationCap,
  School,
  Trophy,
  Award,
  Star,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface TeacherDashboardProps {
  cohorts: Cohort[];
  cohortLevels?: CohortLevel[];
  cohortClasses?: CohortClass[];
  learners: Learner[];
  registers: DailyRegister[];
  onNavigate: (tab: TeacherTab) => void;
  onVerifyRegister: (regId: string) => Promise<void> | void;
  onSelectGradeFilter?: (levelFilter: string) => void;
  onSelectSchoolFilter?: (schoolFilter: string) => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  cohorts,
  cohortLevels = [],
  cohortClasses = [],
  learners,
  registers,
  onNavigate,
  onVerifyRegister,
  onSelectGradeFilter,
  onSelectSchoolFilter,
}) => {
  // Nairobi local date
  const nairobiToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const todayRegisters = registers.filter((r) => r.date === nairobiToday);

  // Key stats
  const totalCohorts = cohorts.length;
  const activeCohorts = cohorts.filter((c) => c.status === 'active').length;
  const totalLearners = learners.length;

  const presentCount = todayRegisters.filter((r) => r.status === 'present').length;
  const lateCount = todayRegisters.filter((r) => r.status === 'late').length;
  const absentCount = todayRegisters.filter((r) => r.status === 'absent').length;
  const excusedCount = todayRegisters.filter((r) => r.status === 'excused').length;

  const uniquePresentOrLateLearners = new Set(
    todayRegisters
      .filter((r) => r.status === 'present' || r.status === 'late')
      .map((r) => r.learnerDocId)
  ).size;

  const pendingReviews = registers.filter((r) => r.verificationStatus === 'pending_verification');
  const learnersRequiringSupport = registers.filter(
    (r) => r.understandingLevel === 'needs_support'
  );

  // Chart data: Attendance Today
  const attendanceChartData = [
    { name: 'Present', count: presentCount, color: '#10b981' },
    { name: 'Late', count: lateCount, color: '#f59e0b' },
    { name: 'Absent', count: absentCount, color: '#ef4444' },
    { name: 'Excused', count: excusedCount, color: '#6366f1' },
  ];

  // Chart data: Understanding Levels across all recent registers
  const understandingCounts = {
    excellent: registers.filter((r) => r.understandingLevel === 'excellent').length,
    good: registers.filter((r) => r.understandingLevel === 'good').length,
    fair: registers.filter((r) => r.understandingLevel === 'fair').length,
    needs_support: registers.filter((r) => r.understandingLevel === 'needs_support').length,
  };

  const understandingChartData = [
    { name: 'Excellent', count: understandingCounts.excellent, color: '#0f766e' },
    { name: 'Good', count: understandingCounts.good, color: '#2563eb' },
    { name: 'Fair', count: understandingCounts.fair, color: '#f59e0b' },
    { name: 'Needs Support', count: understandingCounts.needs_support, color: '#e11d48' },
  ];

  // Learner counts by Grade Tier (Play Group, Lower Primary, Upper Primary, Junior School, Senior School)
  const levelCounts: Record<string, number> = {
    playgroup: 0,
    lower_primary: 0,
    upper_primary: 0,
    junior_school: 0,
    senior_school: 0,
    unspecified: 0,
  };

  learners.forEach((lr) => {
    const primaryCohort = cohorts.find((c) => (lr.assignedCohortIds || []).includes(c.id));
    const tier = classifyEducationLevel(lr.grade, primaryCohort?.learningLevel);
    levelCounts[tier] = (levelCounts[tier] || 0) + 1;
  });

  const bandColors: Record<string, { badge: string; bar: string; border: string; bg: string }> = {
    playgroup: {
      badge: 'bg-pink-100 text-pink-800',
      bar: '#db2777',
      border: 'border-pink-200 hover:border-pink-400',
      bg: 'bg-pink-50/50',
    },
    lower_primary: {
      badge: 'bg-amber-100 text-amber-900',
      bar: '#d97706',
      border: 'border-amber-200 hover:border-amber-400',
      bg: 'bg-amber-50/50',
    },
    upper_primary: {
      badge: 'bg-emerald-100 text-emerald-900',
      bar: '#059669',
      border: 'border-emerald-200 hover:border-emerald-400',
      bg: 'bg-emerald-50/50',
    },
    junior_school: {
      badge: 'bg-blue-100 text-blue-900',
      bar: '#2563eb',
      border: 'border-blue-200 hover:border-blue-400',
      bg: 'bg-blue-50/50',
    },
    senior_school: {
      badge: 'bg-indigo-100 text-indigo-900',
      bar: '#4f46e5',
      border: 'border-indigo-200 hover:border-indigo-400',
      bg: 'bg-indigo-50/50',
    },
  };

  const levelChartData = EDUCATION_LEVEL_BANDS.map((band) => ({
    key: band.key,
    name: band.label,
    shortRange: band.shortRange,
    count: levelCounts[band.key] || 0,
    color: bandColors[band.key].bar,
  }));

  const schoolsBreakdown = useMemo(() => {
    const groups = new Map<string, { name: string; count: number }>();
    learners.forEach((l) => {
      const raw = (l.schoolName || 'Sangurur Comprehensive School').trim().replace(/\s+/g, ' ');
      const displayName = raw || 'Sangurur Comprehensive School';
      const key = displayName.toLowerCase();
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        // Prefer properly capitalized display name if the first encountered was all lowercase
        if (existing.name === existing.name.toLowerCase() && displayName !== displayName.toLowerCase()) {
          existing.name = displayName;
        }
      } else {
        groups.set(key, { name: displayName, count: 1 });
      }
    });
    const total = learners.length;
    return Array.from(groups.values())
      .map((item) => ({
        ...item,
        percentage: total > 0 ? Math.round((item.count / total) * 100) : 0,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name);
      });
  }, [learners]);

  const distinctSchoolsCount = schoolsBreakdown.length;

  const [topUnderstandingFilter, setTopUnderstandingFilter] = useState<'top' | 'excellent' | 'good'>('top');
  const [showAllTopTen, setShowAllTopTen] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const handleVerifyClick = async (regId: string) => {
    setVerifyError(null);
    setVerifyingId(regId);
    try {
      await onVerifyRegister(regId);
    } catch (err: any) {
      setVerifyError(err?.message || 'Unable to verify student register. Please try again.');
    } finally {
      setVerifyingId(null);
    }
  };

  const topPerformingStudents = useMemo(() => {
    const learnerById = new Map<string, Learner>();
    learners.forEach((l) => learnerById.set(l.id, l));

    const classById = new Map<string, CohortClass>();
    cohortClasses.forEach((c) => classById.set(c.id, c));

    const cohortById = new Map<string, Cohort>();
    cohorts.forEach((c) => cohortById.set(c.id, c));

    const scoreMap: Record<UnderstandingLevel, number> = {
      excellent: 100,
      good: 75,
      fair: 50,
      needs_support: 25,
    };

    interface LearnerAgg {
      learnerDocId: string;
      fullName: string;
      digitalId: string;
      className: string;
      cohortLabel: string;
      totalRated: number;
      excellentCount: number;
      goodCount: number;
      fairCount: number;
      needsSupportCount: number;
      totalScore: number;
      latestDate: string;
      latestLevel: UnderstandingLevel;
      latestTopic: string;
    }

    const aggMap = new Map<string, LearnerAgg>();

    registers.forEach((r) => {
      if (!r.understandingLevel || r.didStudy === false) return;
      const lvl = r.understandingLevel;
      const learner = learnerById.get(r.learnerDocId);
      const cls =
        (r.classId && classById.get(r.classId)) ||
        (learner?.classId && classById.get(learner.classId)) ||
        undefined;
      const coh =
        cohortById.get(r.cohortId) ||
        (learner?.assignedCohortIds?.[0] ? cohortById.get(learner.assignedCohortIds[0]) : undefined);

      const cur = aggMap.get(r.learnerDocId) || {
        learnerDocId: r.learnerDocId,
        fullName: learner?.fullName || r.learnerName,
        digitalId: learner?.digitalId || learner?.learnerId || r.learnerId,
        className: cls?.name || r.className || learner?.className || learner?.grade || 'Enrolled Learner',
        cohortLabel: coh?.name || r.cohortCode || '',
        totalRated: 0,
        excellentCount: 0,
        goodCount: 0,
        fairCount: 0,
        needsSupportCount: 0,
        totalScore: 0,
        latestDate: r.date,
        latestLevel: lvl,
        latestTopic: r.topicTitle || '',
      };

      cur.totalRated += 1;
      if (lvl === 'excellent') cur.excellentCount += 1;
      else if (lvl === 'good') cur.goodCount += 1;
      else if (lvl === 'fair') cur.fairCount += 1;
      else if (lvl === 'needs_support') cur.needsSupportCount += 1;
      cur.totalScore += scoreMap[lvl];

      if (r.date >= cur.latestDate) {
        cur.latestDate = r.date;
        cur.latestLevel = lvl;
        if (r.topicTitle) cur.latestTopic = r.topicTitle;
      }

      aggMap.set(r.learnerDocId, cur);
    });

    const ranked = Array.from(aggMap.values())
      .map((item) => {
        const understandingIndex = Math.round(item.totalScore / item.totalRated);
        const dominantLevel: UnderstandingLevel =
          understandingIndex >= 88
            ? 'excellent'
            : understandingIndex >= 65
            ? 'good'
            : understandingIndex >= 40
            ? 'fair'
            : 'needs_support';
        return {
          ...item,
          understandingIndex,
          dominantLevel,
        };
      })
      .filter((item) => {
        if (topUnderstandingFilter === 'excellent') {
          return item.excellentCount > 0 && item.understandingIndex >= 75;
        }
        if (topUnderstandingFilter === 'good') {
          return item.goodCount > 0 || item.dominantLevel === 'good';
        }
        return item.dominantLevel === 'excellent' || item.dominantLevel === 'good' || item.understandingIndex >= 50;
      })
      .sort((a, b) => {
        if (b.understandingIndex !== a.understandingIndex) {
          return b.understandingIndex - a.understandingIndex;
        }
        if (b.excellentCount !== a.excellentCount) {
          return b.excellentCount - a.excellentCount;
        }
        if (b.totalRated !== a.totalRated) {
          return b.totalRated - a.totalRated;
        }
        if (b.goodCount !== a.goodCount) {
          return b.goodCount - a.goodCount;
        }
        return a.fullName.localeCompare(b.fullName);
      });

    return ranked;
  }, [learners, cohortClasses, cohorts, registers, topUnderstandingFilter]);

  return (
    <div className="space-y-6">
      {/* Top Welcome & Quick Actions */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              Teacher & Administrator Overview
            </span>
            <span className="text-sm text-slate-500 font-medium">Sangurur Comprehensive School</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
            Academic & Register Operations
          </h1>
          <p className="text-sm text-slate-500">
            Current Local Date: <strong className="text-slate-800">{nairobiToday}</strong> (Africa/Nairobi EAT)
          </p>
        </div>

        {/* Quick action buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => onNavigate('cohorts')}
            className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-bold transition flex items-center space-x-1.5 shadow-xs"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Cohort</span>
          </button>

          <button
            onClick={() => onNavigate('learners')}
            className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-bold transition flex items-center space-x-1.5 shadow-xs"
          >
            <Users className="w-4 h-4" />
            <span>Register Learners</span>
          </button>

          <button
            onClick={() => onNavigate('attendance')}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold transition flex items-center space-x-1.5 shadow-xs"
          >
            <ClipboardList className="w-4 h-4" />
            <span>Attendance Register</span>
          </button>

          <button
            onClick={() => onNavigate('reports')}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-sm font-bold transition flex items-center space-x-1.5 shadow-xs"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Reports Dossier</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div
          onClick={() => onNavigate('cohorts')}
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-emerald-300 transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Total Cohorts</span>
            <Users className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-slate-900">{totalCohorts}</p>
          <p className="text-xs text-emerald-700 font-medium mt-1">
            {cohortClasses.length > 0 || cohortLevels.length > 0
              ? `${activeCohorts} Active • ${cohortLevels.length} Levels • ${cohortClasses.length} Classes`
              : `${activeCohorts} Active Cohorts`}
          </p>
        </div>

        <div
          onClick={() => onNavigate('learners')}
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-blue-300 transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Total Learners</span>
            <GraduationCap className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-black text-slate-900">{totalLearners}</p>
          <p className="text-xs text-blue-700 font-medium mt-1">Enrolled Students</p>
        </div>

        <div
          onClick={() => {
            if (onSelectSchoolFilter) onSelectSchoolFilter('all');
            else onNavigate('learners');
          }}
          className="bg-white p-4 rounded-2xl border border-teal-200 shadow-xs hover:border-teal-400 transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-teal-700 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Schools</span>
            <School className="w-4 h-4 text-teal-600" />
          </div>
          <p className="text-2xl font-black text-slate-900">{distinctSchoolsCount}</p>
          <p className="text-xs text-teal-700 font-medium mt-1">
            {distinctSchoolsCount === 1 ? 'Participating School' : 'Schools Represented'}
          </p>
        </div>

        <div
          onClick={() => onNavigate('attendance')}
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-emerald-300 transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Today's Attendance</span>
            <UserCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline space-x-1.5">
            <p className="text-2xl font-black text-emerald-700">{uniquePresentOrLateLearners}</p>
            <span className="text-sm text-slate-400">/ {totalLearners}</span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Unique learners checked in
          </p>
        </div>

        <div
          onClick={() => onNavigate('understanding')}
          className="bg-white p-4 rounded-2xl border border-rose-200 shadow-xs hover:border-rose-400 transition cursor-pointer ring-1 ring-rose-100"
        >
          <div className="flex items-center justify-between text-rose-500 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Require Support</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-2xl font-black text-rose-700">{learnersRequiringSupport.length}</p>
          <p className="text-xs text-rose-600 font-semibold mt-1">Intervention Alert</p>
        </div>

        <div
          onClick={() => onNavigate('attendance')}
          className="bg-white p-4 rounded-2xl border border-amber-200 shadow-xs hover:border-amber-400 transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-amber-600 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Pending Reviews</span>
            <ClipboardList className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-black text-amber-700">{pendingReviews.length}</p>
          <p className="text-xs text-amber-800 font-semibold mt-1">Requires Verification</p>
        </div>
      </div>

      {/* Explicit Daily Attendance Status Strip: Present / Late / Absent / Excused */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase text-emerald-800 block">Present Today</span>
            <span className="text-xl font-black text-emerald-950">{presentCount}</span>
          </div>
          <UserCheck className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase text-amber-800 block">Late Today</span>
            <span className="text-xl font-black text-amber-950">{lateCount}</span>
          </div>
          <Clock className="w-5 h-5 text-amber-600" />
        </div>
        <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase text-rose-800 block">Absent Today</span>
            <span className="text-xl font-black text-rose-950">{absentCount}</span>
          </div>
          <UserX className="w-5 h-5 text-rose-600" />
        </div>
        <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase text-indigo-800 block">Excused Today</span>
            <span className="text-xl font-black text-indigo-950">{excusedCount}</span>
          </div>
          <ShieldAlert className="w-5 h-5 text-indigo-600" />
        </div>
      </div>

      {/* Learners by Grade Level: Play Group, Lower Primary, Upper Primary, Junior School, Senior School */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center space-x-2">
              <GraduationCap className="w-5 h-5 text-emerald-700" />
              <h3 className="font-extrabold text-base text-slate-900">
                Learners by Grade & Education Level
              </h3>
              {distinctSchoolsCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold inline-flex items-center space-x-1">
                  <School className="w-3.5 h-3.5 text-emerald-700" />
                  <span>
                    {distinctSchoolsCount} {distinctSchoolsCount === 1 ? 'School' : 'Schools'} Represented
                  </span>
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Distribution across Play Group, Lower Primary, Upper Primary, Junior School, and Senior School — click any level to filter learners.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (onSelectGradeFilter) onSelectGradeFilter('all');
              else onNavigate('learners');
            }}
            className="text-sm font-bold text-emerald-700 hover:text-emerald-800 flex items-center space-x-1 self-start sm:self-auto"
          >
            <span>Filter by School & Grade</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {levelChartData.map((tier) => {
            const style = bandColors[tier.key];
            const pct = totalLearners > 0 ? Math.round((tier.count / totalLearners) * 100) : 0;
            return (
              <button
                key={tier.key}
                type="button"
                onClick={() => {
                  if (onSelectGradeFilter) onSelectGradeFilter(`level:${tier.key}`);
                  else onNavigate('learners');
                }}
                className={`text-left p-3.5 rounded-xl border ${style.border} ${style.bg} transition cursor-pointer flex flex-col justify-between space-y-2`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`px-2 py-0.5 rounded-md text-xs font-extrabold uppercase ${style.badge}`}>
                    {tier.name}
                  </span>
                  <span className="text-xs font-bold text-slate-500">{pct}%</span>
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-900">{tier.count}</p>
                  <p className="text-xs text-slate-500 font-medium">{tier.shortRange}</p>
                </div>
              </button>
            );
          })}
        </div>

        {levelCounts.unspecified > 0 && (
          <p className="text-xs text-slate-500">
            * {levelCounts.unspecified} learner{levelCounts.unspecified === 1 ? '' : 's'} currently have no specific grade recorded.
          </p>
        )}
      </div>

      {/* Participating Schools Breakdown */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center space-x-2">
              <School className="w-5 h-5 text-teal-700" />
              <h3 className="font-extrabold text-base text-slate-900">
                Learners by Participating School ({distinctSchoolsCount}{' '}
                {distinctSchoolsCount === 1 ? 'School' : 'Schools'})
              </h3>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Number of schools from which enrolled learners are from — click any school to view and manage its students.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (onSelectSchoolFilter) onSelectSchoolFilter('all');
              else onNavigate('learners');
            }}
            className="text-sm font-bold text-teal-700 hover:text-teal-800 flex items-center space-x-1 self-start sm:self-auto"
          >
            <span>View All Schools</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

        {schoolsBreakdown.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
            No learners registered yet. Register learners to view participating school counts.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {schoolsBreakdown.map((school) => (
              <button
                key={school.name.toLowerCase()}
                type="button"
                onClick={() => {
                  if (onSelectSchoolFilter) onSelectSchoolFilter(school.name);
                  else onNavigate('learners');
                }}
                className="text-left p-3.5 rounded-xl border border-slate-200 hover:border-teal-400 bg-slate-50/60 hover:bg-teal-50/40 transition cursor-pointer space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-extrabold text-slate-900 leading-snug line-clamp-2">
                    {school.name}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-teal-100 text-teal-900 text-xs font-extrabold shrink-0">
                    {school.count} {school.count === 1 ? 'Learner' : 'Learners'}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                    <span>Share of Enrollment</span>
                    <span className="text-slate-700 font-bold">{school.percentage}%</span>
                  </div>
                  <svg
                    viewBox="0 0 100 6"
                    preserveAspectRatio="none"
                    className="h-1.5 w-full rounded-full bg-slate-200 block overflow-hidden"
                    aria-label={`${school.name}: ${school.percentage}%`}
                  >
                    <rect
                      x="0"
                      y="0"
                      width={school.percentage}
                      height="6"
                      rx="3"
                      className="fill-teal-600"
                    />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Today's Attendance Breakdown */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-extrabold text-base text-slate-900">
                Today's Attendance Status Breakdown
              </h3>
              <p className="text-sm text-slate-500">
                Live attendance across cohorts for {nairobiToday}
              </p>
            </div>
            <span className="text-sm font-bold text-slate-400">Total: {todayRegisters.length}</span>
          </div>

          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attendanceChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(val: any) => [`${val} Learners`, 'Count']}
                  contentStyle={{ borderRadius: '0.75rem', fontSize: '13px' }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {attendanceChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Cumulative Understanding Distribution */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-extrabold text-base text-slate-900">
                Learner Understanding Distribution
              </h3>
              <p className="text-sm text-slate-500">
                Self-reported ratings on covered curriculum topics
              </p>
            </div>
            <button
              onClick={() => onNavigate('understanding')}
              className="text-sm font-bold text-emerald-700 hover:text-emerald-800 flex items-center space-x-1"
            >
              <span>Full Analytics</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={understandingChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(val: any) => [`${val} Responses`, 'Total']}
                  contentStyle={{ borderRadius: '0.75rem', fontSize: '13px' }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {understandingChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Performing Students by Level of Understanding */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start space-x-3">
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 shrink-0">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900">
                Top Performing Students (By Level of Understanding)
              </h3>
              <p className="text-sm text-slate-500 mt-0.5">
                Ranked by average understanding score across logged lessons (Excellent 100%, Good 75%, Fair 50%) and session consistency.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm font-bold">
              {(
                [
                  { id: 'top', label: 'All Top' },
                  { id: 'excellent', label: 'Excellent' },
                  { id: 'good', label: 'Good' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTopUnderstandingFilter(opt.id)}
                  className={`px-3 py-1 rounded-lg transition ${
                    topUnderstandingFilter === opt.id
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onNavigate('understanding')}
              className="text-sm font-bold text-emerald-700 hover:text-emerald-800 flex items-center space-x-1 ml-1"
            >
              <span>Full Analytics</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {topPerformingStudents.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 space-y-1.5">
            <Award className="w-7 h-7 text-slate-300 mx-auto" />
            <p className="font-bold text-slate-700">No rated student understanding submissions yet</p>
            <p>
              Once learners submit daily registers with their lesson understanding ratings, top performers will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {(showAllTopTen
              ? topPerformingStudents.slice(0, 10)
              : topPerformingStudents.slice(0, 5)
            ).map((student, idx) => {
              const rank = idx + 1;
              const isTopThree = rank <= 3;
              const levelLabel =
                student.dominantLevel === 'excellent'
                  ? 'Excellent Understanding'
                  : student.dominantLevel === 'good'
                  ? 'Good Understanding'
                  : 'Fair Understanding';
              const barFillClass =
                student.dominantLevel === 'excellent'
                  ? 'fill-emerald-600'
                  : student.dominantLevel === 'good'
                  ? 'fill-blue-600'
                  : 'fill-amber-500';
              const rankStyle =
                rank === 1
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : rank === 2
                  ? 'bg-slate-200 text-slate-800 border-slate-300'
                  : rank === 3
                  ? 'bg-orange-100 text-orange-900 border-orange-300'
                  : 'bg-slate-50 text-slate-600 border-slate-200';

              return (
                <div
                  key={student.learnerDocId}
                  className="p-4 hover:bg-slate-50/80 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-start sm:items-center space-x-3.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center font-black text-sm shrink-0 ${rankStyle}`}
                    >
                      {isTopThree ? <Star className="w-3.5 h-3.5 mr-0.5 fill-current" /> : null}
                      <span>{rank}</span>
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-extrabold text-slate-900 truncate">
                          {student.fullName}
                        </p>
                        <span className="font-mono text-xs font-bold text-blue-700">
                          {student.digitalId}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 truncate">
                        {student.className}
                        {student.cohortLabel ? ` • ${student.cohortLabel}` : ''}
                        {student.latestTopic ? ` • Latest: ${student.latestTopic}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center justify-between md:justify-end gap-4 sm:gap-6 shrink-0">
                    <div className="text-sm text-slate-600 flex items-center space-x-3">
                      <div>
                        <span className="block text-xs font-bold uppercase text-slate-400">
                          Excellent
                        </span>
                        <strong className="text-emerald-700">{student.excellentCount}</strong>
                      </div>
                      <div>
                        <span className="block text-xs font-bold uppercase text-slate-400">
                          Good
                        </span>
                        <strong className="text-blue-700">{student.goodCount}</strong>
                      </div>
                      <div>
                        <span className="block text-xs font-bold uppercase text-slate-400">
                          Sessions
                        </span>
                        <strong className="text-slate-800">{student.totalRated}</strong>
                      </div>
                    </div>

                    <div className="w-36 space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-bold text-slate-700 truncate">{levelLabel.split(' ')[0]}</span>
                        <span className="font-black text-slate-900">{student.understandingIndex}%</span>
                      </div>
                      <svg
                        viewBox="0 0 100 8"
                        preserveAspectRatio="none"
                        className="h-2 w-full rounded-full bg-slate-100 block overflow-hidden"
                        aria-label={`Understanding score ${student.understandingIndex}%`}
                      >
                        <rect
                          x="0"
                          y="0"
                          width={student.understandingIndex}
                          height="8"
                          rx="4"
                          className={barFillClass}
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              );
            })}

            {topPerformingStudents.length > 5 && (
              <div className="px-5 py-3 bg-slate-50/70 flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  Showing top {Math.min(showAllTopTen ? 10 : 5, topPerformingStudents.length)} of{' '}
                  {topPerformingStudents.length} ranked students
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllTopTen((prev) => !prev)}
                  className="font-bold text-emerald-700 hover:underline"
                >
                  {showAllTopTen ? 'Show Top 5' : 'Show Top 10'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pending Reviews & Interventions Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Verification Submissions */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ClipboardList className="w-4 h-4 text-amber-600" />
              <h3 className="text-base font-extrabold text-slate-900">
                Pending Verification ({pendingReviews.length})
              </h3>
            </div>
            <button
              onClick={() => onNavigate('attendance')}
              className="text-sm font-bold text-emerald-700 hover:underline"
            >
              Open Register
            </button>
          </div>

          {verifyError && (
            <div className="mx-4 mt-3 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2">
              <span>{verifyError}</span>
              <button
                type="button"
                onClick={() => setVerifyError(null)}
                className="font-bold text-rose-600 hover:text-rose-800 shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {pendingReviews.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
                All learner self-submitted registers have been verified!
              </div>
            ) : (
              pendingReviews.slice(0, 5).map((r) => (
                <div key={r.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-slate-900">{r.learnerName}</p>
                    <p className="text-xs text-slate-500">
                      ID: {r.learnerId} • Cohort: {r.cohortCode} • Date: {r.date}
                    </p>
                    <p className="text-xs text-emerald-700 font-medium">
                      Topic: {r.topicTitle || 'General Lesson'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={verifyingId === r.id}
                    onClick={() => handleVerifyClick(r.id)}
                    className="py-1.5 px-3 bg-emerald-100 hover:bg-emerald-200 disabled:opacity-50 text-emerald-800 font-bold rounded-lg text-sm transition"
                  >
                    {verifyingId === r.id ? 'Verifying...' : 'Verify'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Learners Requiring Support Intervention */}
        <div className="bg-white rounded-2xl border border-rose-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-rose-200 bg-rose-50/50 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <h3 className="text-base font-extrabold text-rose-950">
                Support Alert Watchlist ({learnersRequiringSupport.length})
              </h3>
            </div>
            <button
              onClick={() => onNavigate('understanding')}
              className="text-sm font-bold text-rose-700 hover:underline"
            >
              Intervention Details
            </button>
          </div>

          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {learnersRequiringSupport.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
                No learners currently flagged for urgent support.
              </div>
            ) : (
              learnersRequiringSupport.slice(0, 5).map((r) => (
                <div key={r.id} className="p-3.5 hover:bg-rose-50/30 space-y-1">
                  <div className="flex justify-between items-start">
                    <span className="text-sm font-bold text-slate-900">{r.learnerName}</span>
                    <span className="text-xs font-bold text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full">
                      Needs Support
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Topic: <strong>{r.topicTitle || 'N/A'}</strong> ({r.date})
                  </p>
                  {r.reflectionDifficult && (
                    <p className="text-xs text-slate-500 italic bg-slate-50 p-1.5 rounded-md">
                      "{r.reflectionDifficult}"
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
