import React, { useState } from 'react';
import { SchoolLogo } from './SchoolLogo';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  BookOpen,
  ClipboardCheck,
  TrendingUp,
  BrainCircuit,
  FileSpreadsheet,
  Settings,
  X,
  CalendarDays,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

export type TeacherTab =
  | 'dashboard'
  | 'cohorts'
  | 'learners'
  | 'curriculum-library'
  | 'curriculum-builder'
  | 'timetable'
  | 'attendance'
  | 'progress'
  | 'understanding'
  | 'reports'
  | 'settings';

interface SidebarProps {
  currentTab: TeacherTab;
  onSelectTab: (tab: TeacherTab) => void;
  pendingReviewsCount?: number;
  supportAlertCount?: number;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  pendingReviewsCount = 0,
  supportAlertCount = 0,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sdlr_teacher_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sdlr_teacher_sidebar_collapsed', String(next));
      } catch {
        // ignore storage restrictions
      }
      return next;
    });
  };

  const navItems = [
    {
      id: 'dashboard' as TeacherTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'Overview & key metrics',
    },
    {
      id: 'cohorts' as TeacherTab,
      label: 'My Cohorts',
      icon: Users,
      description: 'Classes & assignments',
    },
    {
      id: 'learners' as TeacherTab,
      label: 'Learner Management',
      icon: UserPlus,
      description: 'Individual & bulk registration',
    },
    {
      id: 'curriculum-library' as TeacherTab,
      label: 'Curriculum Library & Builder',
      icon: BookOpen,
      description: 'Templates & interactive builder',
    },
    {
      id: 'timetable' as TeacherTab,
      label: 'Weekly Timetable',
      icon: CalendarDays,
      description: 'Nov/Dec holiday & weekly topics',
    },
    {
      id: 'attendance' as TeacherTab,
      label: 'Attendance Register',
      icon: ClipboardCheck,
      description: 'Daily tracking & verification',
      badge: pendingReviewsCount > 0 ? pendingReviewsCount : undefined,
      badgeColor: 'bg-amber-400 text-slate-950 border-amber-300',
    },
    {
      id: 'progress' as TeacherTab,
      label: 'Learning Progress',
      icon: TrendingUp,
      description: 'Exposure & verified mastery',
    },
    {
      id: 'understanding' as TeacherTab,
      label: 'Understanding Analytics',
      icon: BrainCircuit,
      description: 'Self-ratings & intervention list',
      badge: supportAlertCount > 0 ? supportAlertCount : undefined,
      badgeColor: 'bg-rose-500 text-white border-rose-400',
    },
    {
      id: 'reports' as TeacherTab,
      label: 'Reports & Exports',
      icon: FileSpreadsheet,
      description: 'PDF, Excel & CSV dossier',
    },
    {
      id: 'settings' as TeacherTab,
      label: 'Settings',
      icon: Settings,
      description: 'School rules & audit logs',
    },
  ];

  const handleSelect = (tab: TeacherTab) => {
    onSelectTab(tab);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-x-0 top-16 bottom-0 z-20 bg-black/50 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed top-16 bottom-0 left-0 z-30 w-64 ${
          collapsed ? 'lg:w-20' : 'lg:w-64'
        } bg-gradient-to-b from-emerald-900 via-emerald-800 to-emerald-950 text-white border-r border-emerald-950/60 shrink-0 flex flex-col justify-between py-4 overflow-y-auto transition-all duration-200 ease-in-out lg:sticky lg:top-16 lg:z-20 lg:h-[calc(100vh-4rem)] lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div>
          <div
            className={`px-4 mb-3 flex items-center ${
              collapsed ? 'lg:justify-center lg:px-2' : 'justify-between'
            }`}
          >
            <p
              className={`text-xs font-bold tracking-wider text-emerald-200/80 uppercase ${
                collapsed ? 'lg:hidden' : ''
              }`}
            >
              Teacher Navigation
            </p>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={toggleCollapsed}
                title={collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
                aria-label={collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
                className="hidden lg:inline-flex p-1.5 rounded-lg text-emerald-100 hover:text-white hover:bg-emerald-700/60 transition-colors"
              >
                {collapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
              {onCloseMobile && (
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="lg:hidden p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-emerald-700/60"
                  aria-label="Close navigation menu"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <nav className="space-y-1 px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                currentTab === item.id ||
                (item.id === 'curriculum-library' && currentTab === 'curriculum-builder');

              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={`relative w-full flex items-center ${
                    collapsed ? 'lg:justify-center lg:px-2' : 'justify-between px-3'
                  } px-3 py-2.5 rounded-xl text-left text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-white text-emerald-900 shadow-sm'
                      : 'text-emerald-50 hover:bg-emerald-700/60 hover:text-white'
                  }`}
                >
                  <div
                    className={`flex items-center ${
                      collapsed ? 'lg:space-x-0' : 'space-x-3'
                    } space-x-3 truncate`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-emerald-700' : 'text-emerald-200'
                      }`}
                    />
                    <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>
                      {item.label}
                    </span>
                  </div>

                  {item.badge !== undefined && (
                    <span
                      className={`${
                        collapsed
                          ? 'lg:absolute lg:top-1 lg:right-1 lg:px-1 lg:text-xs lg:leading-tight'
                          : 'ml-2 px-1.5 py-0.5 text-xs'
                      } ml-2 px-1.5 py-0.5 text-xs font-bold rounded-full border ${
                        isActive ? 'bg-emerald-700 text-white border-emerald-700' : item.badgeColor
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Institutional Footer in Sidebar */}
        <div
          className={`px-4 pt-4 border-t border-emerald-700/60 text-sm text-emerald-100 flex items-center ${
            collapsed ? 'lg:justify-center lg:px-2' : 'space-x-2.5'
          } space-x-2.5`}
        >
          <div className="bg-white p-0.5 rounded-lg border border-emerald-600/40 shrink-0">
            <SchoolLogo className={collapsed ? 'w-9 h-9' : 'w-10 h-10'} />
          </div>
          <div className={`min-w-0 space-y-0.5 ${collapsed ? 'lg:hidden' : ''}`}>
            <p className="text-sm font-bold text-white truncate">Sangurur Comprehensive</p>
            <p className="text-xs text-emerald-200 font-medium">Think, Code, Change the World</p>
            <p className="text-xs text-emerald-300/80">Africa/Nairobi (EAT)</p>
          </div>
        </div>
      </aside>
    </>
  );
};
