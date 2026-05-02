"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Users,
  Database,
  AlertTriangle,
  Play,
  Pause,
  Settings,
  ChevronDown,
  Check,
} from "lucide-react";
import { extractModuleIdFromPath } from "@/lib/modulePath";
import { SESSION_INACTIVITY_MS } from "@/lib/sessionConstants";
import { resolveDisplayNameFromMap } from "@/lib/userPoolKey";
import {
  parseOc4dModuleAccessLine,
  parseOc4dModuleAssetHeartbeat,
} from "@/lib/oc4dLogLine";
import {
  postModulefetchIngest,
  sessionToModulefetchUserId,
} from "@/lib/postModulefetchIngest";

interface UserSession {
  ip: string;
  username: string;
  /** Cached `User.name` from server when `User.email` matches log identity. */
  displayName?: string;
  module: string;
  startTime: Date;
  duration: number;
  lastActivity: Date;
}

interface ModuleTimer {
  moduleName: string;
  timeLimit: number; // in minutes
  isActive: boolean;
}

interface Stats {
  totalModules: number;
  totalCategories: number;
  uniqueUsersToday: number;
  activeSessions: number;
  /** From server env MODULEFETCH_PERIODIC_FLUSH_MINUTES (zip snapshots while monitoring). */
  modulefetchPeriodicFlushMinutes?: number;
  /** Server-side journalctl + sessions (MODULEGAZE_BACKGROUND_MONITOR). */
  backgroundModuleMonitor?: boolean;
}

interface Module {
  id: string;
  name: string;
  description: string;
  language: string;
  indexHtmlUrl: string;
  logoUrl: string;
  categories: { name: string; description: string }[];
}

export default function CDNModuleMonitor() {
  const [userSessions, setUserSessions] = useState<UserSession[]>([]);
  const [moduleTimers, setModuleTimers] = useState<ModuleTimer[]>([
    { moduleName: "default", timeLimit: 1, isActive: false },
  ]);
  const [stats, setStats] = useState<Stats>({
    totalModules: 0,
    totalCategories: 0,
    uniqueUsersToday: 0,
    activeSessions: 0,
  });
  const [alerts, setAlerts] = useState<string[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [selectedModule, setSelectedModule] = useState("");
  const [timerMinutes, setTimerMinutes] = useState("");
  const [modules, setModules] = useState<Module[]>([]);
  /** Normalized login_key → display_name from GET /api/user-pool */
  const [userPoolMap, setUserPoolMap] = useState<Record<string, string>>({});
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  /** Server hint when live journalctl is unavailable (e.g. Windows). */
  const [logSourceInfo, setLogSourceInfo] = useState<{ reason: string } | null>(
    null
  );
  /** Pause polling server sessions (background mode only). */
  const [backgroundViewPaused, setBackgroundViewPaused] = useState(false);
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const eventSourceRef = useRef<EventSource | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userSessionsRef = useRef<UserSession[]>([]);

  useEffect(() => {
    userSessionsRef.current = userSessions;
  }, [userSessions]);

  const labelForSessionUser = useCallback(
    (session: UserSession) => {
      if (session.username === "Guest") return "Guest";
      if (session.displayName && session.displayName.length > 0) {
        return session.displayName;
      }
      return resolveDisplayNameFromMap(userPoolMap, session.username);
    },
    [userPoolMap]
  );

  // Find matching module from database based on log module name (slug or URL segment)
  const findMatchingModule = useCallback((logModuleName: string): Module | null => {
    const bySlug = modules.find((module) => {
      const moduleId = extractModuleIdFromPath(module.indexHtmlUrl);
      return moduleId === logModuleName;
    });
    if (bySlug) return bySlug;

    return (
      modules.find(
        (m) =>
          m.indexHtmlUrl.includes(`/modules/${logModuleName}/`) ||
          (m.indexHtmlUrl.includes("/uploads/modules/") &&
            m.indexHtmlUrl.includes(`/${logModuleName}/`))
      ) || null
    );
  }, [modules]);

  // Get display name for a module (from DB if matched, otherwise use log name)
  const getDisplayName = useCallback(
    (logModuleName: string): string => {
      const matchedModule = findMatchingModule(logModuleName);
      return matchedModule ? matchedModule.name : logModuleName;
    },
    [findMatchingModule]
  );

  // Enhanced timer finding with detailed debugging
  const findTimerForSession = useCallback((session: UserSession): ModuleTimer | null => {
    const logModuleName = session.module;
    const matchedModule = findMatchingModule(logModuleName);

    // Debug logging
    const debugMsg = `🔍 Finding timer for session: ${logModuleName}`;
    console.log(debugMsg);

    // Try 1: Direct match with log module name
    let timer = moduleTimers.find(
      (t) => t.moduleName === logModuleName && t.isActive
    );
    if (timer) {
      console.log(
        `✅ Found timer via direct log match: ${timer.moduleName} (${timer.timeLimit}m)`
      );
      return timer;
    }

    // Try 2: Match with database module name
    if (matchedModule) {
      timer = moduleTimers.find(
        (t) => t.moduleName === matchedModule.name && t.isActive
      );
      if (timer) {
        console.log(
          `✅ Found timer via DB module match: ${timer.moduleName} (${timer.timeLimit}m)`
        );
        return timer;
      }
    }

    // Try 3: Check if any timer's module name matches the URL ID of our log module
    const logModuleUrlId = logModuleName; // The log module name IS the URL ID
    timer = moduleTimers.find((t) => {
      if (!t.isActive) return false;

      // Find the module in DB that has this timer name
      const timerModule = modules.find((m) => m.name === t.moduleName);
      if (timerModule) {
        const timerModuleUrlId = extractModuleIdFromPath(
          timerModule.indexHtmlUrl
        );
        return timerModuleUrlId === logModuleUrlId;
      }
      return false;
    });

    if (timer) {
      console.log(
        `✅ Found timer via reverse URL match: ${timer.moduleName} (${timer.timeLimit}m)`
      );
      return timer;
    }

    console.log(`❌ No timer found for: ${logModuleName}`);
    console.log(
      `Available active timers:`,
      moduleTimers.filter((t) => t.isActive).map((t) => t.moduleName)
    );

    return null;
  }, [modules, moduleTimers, findMatchingModule]);

  // Update user session (one row per IP + username from oc4d remote-user field)
  const updateUserSession = useCallback((ip: string, username: string, module: string) => {
    setUserSessions((prev) => {
      const existingIndex = prev.findIndex(
        (session) => session.ip === ip && session.username === username
      );
      const now = new Date();

      if (existingIndex >= 0) {
        const updated = [...prev];
        const existing = updated[existingIndex];

        if (existing.module !== module) {
          updated[existingIndex] = {
            ip,
            username,
            module,
            startTime: now,
            duration: 0,
            lastActivity: now,
          };
        } else {
          updated[existingIndex] = {
            ...existing,
            lastActivity: now,
          };
        }
        return updated;
      }

      return [
        ...prev,
        {
          ip,
          username,
          module,
          startTime: now,
          duration: 0,
          lastActivity: now,
        },
      ];
    });
  }, []);

  /** Extends session lifetime on chunk/css GETs while the user stays in the same module. */
  const touchUserSessionActivity = useCallback(
    (ip: string, username: string, moduleSlug: string) => {
      setUserSessions((prev) => {
        const idx = prev.findIndex(
          (s) =>
            s.ip === ip &&
            s.username === username &&
            s.module === moduleSlug
        );
        if (idx < 0) return prev;
        const now = new Date();
        const next = [...prev];
        next[idx] = { ...next[idx], lastActivity: now };
        return next;
      });
    },
    []
  );

  const addModuleTimer = () => {
    if (selectedModule && timerMinutes) {
      const timer: ModuleTimer = {
        moduleName: selectedModule,
        timeLimit: Number.parseInt(timerMinutes),
        isActive: true,
      };
      setModuleTimers((prev) => {
        // Remove existing timer for this module if it exists
        const filtered = prev.filter((t) => t.moduleName !== selectedModule);
        const newTimers = [...filtered, timer];

        // Debug log
        console.log(
          `🎯 Added/Updated timer: ${selectedModule} -> ${timerMinutes}m`
        );
        console.log(
          `Active timers:`,
          newTimers
            .filter((t) => t.isActive)
            .map((t) => `${t.moduleName}(${t.timeLimit}m)`)
        );

        return newTimers;
      });
      setSelectedModule("");
      setTimerMinutes("");
      setSearchTerm("");
      setIsDropdownOpen(false);
    }
  };

  // Check for timer violations with enhanced debugging
  const checkTimerViolations = useCallback(() => {
    userSessions.forEach((session) => {
      const timer = findTimerForSession(session);

      if (timer && session.duration > timer.timeLimit * 60) {
        const displayName = getDisplayName(session.module);
        const who =
          session.username === "Guest"
            ? `Guest (${session.ip})`
            : `${labelForSessionUser(session)} (${session.ip})`;
        const alertMessage = `⚠️ ${who} has exceeded ${timer.timeLimit} minutes on module "${displayName}"`;
        console.log(`🚨 TIMER VIOLATION: ${alertMessage}`);

        setAlerts((prev) => {
          if (!prev.includes(alertMessage)) {
            return [...prev, alertMessage];
          }
          return prev;
        });
      }
    });
  }, [userSessions, findTimerForSession, getDisplayName, labelForSessionUser]);

  // Remove sessions with no oc4d log activity (SSE "heartbeat") within the window
  const cleanupInactiveSessions = useCallback(() => {
    const staleBefore = new Date(Date.now() - SESSION_INACTIVITY_MS);
    setUserSessions((prev) => {
      const removed = prev.filter((s) => s.lastActivity <= staleBefore);
      const kept = prev.filter((s) => s.lastActivity > staleBefore);
      if (removed.length > 0) {
        queueMicrotask(() => {
          for (const s of removed) {
            void postModulefetchIngest({
              userId: sessionToModulefetchUserId(s),
              moduleId: s.module,
              durationSeconds: s.duration,
            });
          }
        });
      }
      return kept;
    });
  }, []);

  // Update session durations (browser stream only; background uses server snapshot)
  useEffect(() => {
    if (stats.backgroundModuleMonitor) return;
    const interval = setInterval(() => {
      setUserSessions((prev) =>
        prev.map((session) => ({
          ...session,
          duration: Math.floor(
            (Date.now() - session.startTime.getTime()) / 1000
          ), // seconds instead of minutes
        }))
      );

      // Clean up inactive sessions
      cleanupInactiveSessions();
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, [cleanupInactiveSessions, stats.backgroundModuleMonitor]);

  // Check timer violations periodically
  useEffect(() => {
    const interval = setInterval(checkTimerViolations, 5000);
    return () => clearInterval(interval);
  }, [checkTimerViolations]);

  /**
   * Optional: write mf-*.tar.gz snapshots on a timer while monitoring (same ingest as
   * Stop). Server env MODULEFETCH_PERIODIC_FLUSH_MINUTES (exposed via /api/stats).
   */
  useEffect(() => {
    if (!isMonitoring || stats.backgroundModuleMonitor) return;
    const mins = stats.modulefetchPeriodicFlushMinutes ?? 0;
    if (!Number.isFinite(mins) || mins <= 0) return;
    const ms = Math.round(mins * 60 * 1000);
    const id = window.setInterval(() => {
      for (const s of userSessionsRef.current) {
        void postModulefetchIngest({
          userId: sessionToModulefetchUserId(s),
          moduleId: s.module,
          durationSeconds: s.duration,
          recordedAt: new Date().toISOString(),
        });
      }
    }, ms);
    return () => clearInterval(id);
  }, [isMonitoring, stats.modulefetchPeriodicFlushMinutes, stats.backgroundModuleMonitor]);

  const closeEventSourceOnly = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const stopMonitoring = useCallback(() => {
    if (statsRef.current.backgroundModuleMonitor) {
      setBackgroundViewPaused(true);
      setUserSessions([]);
      closeEventSourceOnly();
      setLogSourceInfo(null);
      setIsMonitoring(false);
      return;
    }
    const snapshot = userSessionsRef.current;
    for (const s of snapshot) {
      void postModulefetchIngest({
        userId: sessionToModulefetchUserId(s),
        moduleId: s.module,
        durationSeconds: s.duration,
      });
    }
    setUserSessions([]);
    closeEventSourceOnly();
    setLogSourceInfo(null);
    setIsMonitoring(false);
  }, [closeEventSourceOnly]);

  const startMonitoring = useCallback(() => {
    if (statsRef.current.backgroundModuleMonitor) return;
    if (eventSourceRef.current) return;
    try {
      setLogSourceInfo(null);
      const eventSource = new EventSource("/api/logs/stream");
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("log-source", (ev: Event) => {
        try {
          const me = ev as MessageEvent;
          const data = JSON.parse(me.data) as {
            available?: boolean;
            reason?: string;
          };
          if (data.available === false && data.reason) {
            setLogSourceInfo({ reason: data.reason });
          }
        } catch {
          /* ignore malformed meta */
        }
      });

      eventSource.onmessage = (event) => {
        const logData = JSON.parse(event.data);
        const parsed = parseOc4dModuleAccessLine(logData.line);

        if (parsed) {
          setLogSourceInfo(null);
          console.log(
            `📋 Parsed: ${parsed.username} @ ${parsed.ip} → module ${parsed.module}`
          );
          updateUserSession(parsed.ip, parsed.username, parsed.module);
          return;
        }
        const heartbeat = parseOc4dModuleAssetHeartbeat(logData.line);
        if (heartbeat) {
          setLogSourceInfo(null);
          touchUserSessionActivity(
            heartbeat.ip,
            heartbeat.username,
            heartbeat.module
          );
        }
      };

      eventSource.onerror = (error) => {
        console.error("EventSource failed:", error);
        closeEventSourceOnly();
        setLogSourceInfo(null);
        setIsMonitoring(false);
      };

      setIsMonitoring(true);
    } catch (error) {
      console.error("Failed to start monitoring:", error);
    }
  }, [touchUserSessionActivity, updateUserSession, closeEventSourceOnly]);

  const toggleMonitoring = () => {
    if (statsRef.current.backgroundModuleMonitor) {
      setBackgroundViewPaused((paused) => {
        if (paused) {
          setIsMonitoring(true);
          return false;
        }
        setIsMonitoring(false);
        setUserSessions([]);
        return true;
      });
      return;
    }
    if (isMonitoring) {
      stopMonitoring();
    } else {
      startMonitoring();
    }
  };

  useEffect(() => {
    if (stats.backgroundModuleMonitor) {
      closeEventSourceOnly();
      setIsMonitoring(true);
      setBackgroundViewPaused(false);
      return () => {
        closeEventSourceOnly();
      };
    }
    startMonitoring();
    return () => {
      if (!statsRef.current.backgroundModuleMonitor) {
        stopMonitoring();
      } else {
        closeEventSourceOnly();
      }
    };
  }, [
    stats.backgroundModuleMonitor,
    startMonitoring,
    stopMonitoring,
    closeEventSourceOnly,
  ]);

  useEffect(() => {
    if (!stats.backgroundModuleMonitor || backgroundViewPaused) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/live-sessions");
        const data = (await res.json()) as {
          sessions?: Array<{
            ip: string;
            username: string;
            displayName?: string;
            module: string;
            startTime: string;
            lastActivity: string;
            duration: number;
          }>;
        };
        if (cancelled) return;
        const list = data.sessions ?? [];
        setUserSessions(
          list.map((s) => ({
            ip: s.ip,
            username: s.username,
            displayName: s.displayName,
            module: s.module,
            startTime: new Date(s.startTime),
            lastActivity: new Date(s.lastActivity),
            duration: s.duration,
          }))
        );
      } catch {
        /* ignore */
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stats.backgroundModuleMonitor, backgroundViewPaused]);

  // Format duration for display
  const formatDuration = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainingSeconds = seconds % 60;
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    }
  };

  // Check if session exceeds time limit
  const isSessionOverLimit = (session: UserSession) => {
    const timer = findTimerForSession(session);
    if (!timer) return false;

    const limitInSeconds = timer.timeLimit * 60; // Convert minutes to seconds
    const isOver = session.duration > limitInSeconds;

    if (isOver) {
      console.log(
        `🔴 Session over limit: ${
          session.username === "Guest"
            ? `Guest (${session.ip})`
            : `${labelForSessionUser(session)} @ ${session.ip}`
        } on ${session.module} (${session.duration}s > ${limitInSeconds}s)`
      );
    }

    return isOver;
  };

  // Get unique active modules
  const getActiveModules = () => {
    const modules = new Set(userSessions.map((session) => session.module));
    return modules.size;
  };

  // Fetch modules from API
  const fetchModules = async () => {
    try {
      const response = await fetch("/api/modules");
      const data = await response.json();
      const list: Module[] = Array.isArray(data) ? data : [];
      setModules(list);
      console.log(
        "📚 Loaded modules for matching:",
        list.map((m) => ({
          name: m.name,
          urlId: extractModuleIdFromPath(m.indexHtmlUrl),
        }))
      );
    } catch (error) {
      console.error("Failed to fetch modules:", error);
    }
  };

  const fetchUserPool = async () => {
    try {
      const response = await fetch("/api/user-pool");
      const data = (await response.json()) as { map?: Record<string, string> };
      setUserPoolMap(data.map ?? {});
    } catch (error) {
      console.error("Failed to fetch user pool:", error);
    }
  };

  // Fetch initial stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/stats");
        const data = await response.json();
        setStats(data);
      } catch (error) {
        console.error("Failed to fetch stats:", error);
      }
    };

    const tick = async () => {
      await fetchStats();
      await fetchModules();
      await fetchUserPool();
    };
    void tick();
    const interval = setInterval(() => void tick(), 30000);
    return () => clearInterval(interval);
  }, []);

  // Update stats based on current sessions
  useEffect(() => {
    const uniqueKeys = new Set(
      userSessions.map((s) => `${s.ip}\t${s.username}`)
    );
    setStats((prev) => ({
      ...prev,
      uniqueUsersToday: uniqueKeys.size,
      activeSessions: userSessions.length,
    }));
  }, [userSessions]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Filter modules based on search term (include path/slug so e.g. "en-ebooks" matches)
  const q = searchTerm.toLowerCase().trim();
  const filteredModules = modules.filter((module) => {
    const slug = (extractModuleIdFromPath(module.indexHtmlUrl) ?? "").toLowerCase();
    const url = module.indexHtmlUrl.toLowerCase();
    return (
      module.name.toLowerCase().includes(q) ||
      module.description.toLowerCase().includes(q) ||
      url.includes(q) ||
      slug.includes(q)
    );
  });

  // Check if module has a timer set
  const hasTimer = (moduleName: string) => {
    return moduleTimers.some(
      (timer) =>
        timer.moduleName === moduleName && timer.moduleName !== "default"
    );
  };

  // Get existing timer for module
  const getExistingTimer = (moduleName: string) => {
    return moduleTimers.find(
      (timer) =>
        timer.moduleName === moduleName && timer.moduleName !== "default"
    );
  };

  const handleModuleSelect = (moduleName: string) => {
    setSelectedModule(moduleName);
    setSearchTerm(moduleName);
    setIsDropdownOpen(false);

    // If module already has a timer, populate the time field
    const existingTimer = getExistingTimer(moduleName);
    if (existingTimer) {
      setTimerMinutes(existingTimer.timeLimit.toString());
    } else {
      setTimerMinutes("");
    }
  };

  const toggleTimer = (index: number) => {
    setModuleTimers((prev) => {
      const updatedTimers = [...prev];
      updatedTimers[index].isActive = !updatedTimers[index].isActive;
      return updatedTimers;
    });
  };

  const removeTimer = (index: number) => {
    setModuleTimers((prev) => {
      const updatedTimers = [...prev];
      updatedTimers.splice(index, 1);
      return updatedTimers;
    });
  };

  // Get timer limit for a specific module
  const getModuleTimeLimit = (moduleName: string) => {
    const dummySession: UserSession = {
      ip: "",
      username: "",
      module: moduleName,
      startTime: new Date(0),
      duration: 0,
      lastActivity: new Date(0),
    };
    const timer = findTimerForSession(dummySession);
    return timer ? timer.timeLimit : null;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-9">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-5xl font-bold text-orange-600">
            CDN Module Gaze
          </h1>
          <p className="text-xl text-gray-600">
            Live monitoring of module usage.
          </p>
        </div>

        {/* Debug Panel - Remove this after testing */}
        {/* {userSessions.length > 0 && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardHeader>
              <CardTitle className="text-lg text-yellow-800">
                🐛 Debug Info
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div>
                  <strong>Active Sessions:</strong>
                </div>
                {userSessions.map((session, i) => {
                  const matchedModule = findMatchingModule(session.module);
                  const timer = findTimerForSession(session);
                  return (
                    <div key={i} className="ml-4 text-xs font-mono">
                      • {session.ip} → {session.module}
                      {matchedModule && ` (DB: ${matchedModule.name})`}
                      {timer && ` [Timer: ${timer.timeLimit}m]`}
                      {!timer && ` [No Timer]`}
                    </div>
                  );
                })}
                <div>
                  <strong>Active Timers:</strong>
                </div>
                {moduleTimers
                  .filter((t) => t.isActive)
                  .map((timer, i) => (
                    <div key={i} className="ml-4 text-xs font-mono">
                      • {timer.moduleName} → {timer.timeLimit}m
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )} */}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-700">
                  Live Users
                </CardTitle>
                <Users className="h-5 w-5 text-orange-500" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-4xl font-bold text-gray-900 mb-1">
                {stats.uniqueUsersToday}
              </div>
              <p className="text-sm text-gray-500">
                Distinct user sessions (IP + log identity; name from User when email matches)
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-700">
                  Active Modules
                </CardTitle>
                <Database className="h-5 w-5 text-orange-500" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-4xl font-bold text-gray-900 mb-1">
                {getActiveModules()}
              </div>
              <p className="text-sm text-gray-500">
                Unique modules being accessed
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-700">
                  Module Time Limits
                </CardTitle>
                <Settings className="h-5 w-5 text-orange-500" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                <div className="text-2xl font-bold text-gray-900 mb-2">
                  {moduleTimers.filter((t) => t.isActive).length} Active
                </div>
                <div className="space-y-2">
                  {/* Custom Dropdown */}
                  <div className="relative" ref={dropdownRef}>
                    <div
                      className="flex items-center justify-between w-full h-8 px-3 text-sm border border-gray-300 rounded-md bg-white cursor-pointer hover:border-gray-400 focus-within:border-orange-500 focus-within:ring-1 focus-within:ring-orange-500"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    >
                      <input
                        type="text"
                        placeholder="Search modules..."
                        value={searchTerm}
                        onChange={(e) => {
                          setSearchTerm(e.target.value);
                          setIsDropdownOpen(true);
                        }}
                        className="flex-1 outline-none bg-transparent"
                        onFocus={() => setIsDropdownOpen(true)}
                      />
                      <ChevronDown
                        className={`h-4 w-4 text-gray-400 transition-transform ${
                          isDropdownOpen ? "rotate-180" : ""
                        }`}
                      />
                    </div>

                    {isDropdownOpen && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                        {filteredModules.length > 0 ? (
                          filteredModules.map((module) => {
                            const hasExistingTimer = hasTimer(module.name);
                            const existingTimer = getExistingTimer(module.name);
                            const moduleUrlId = extractModuleIdFromPath(
                              module.indexHtmlUrl
                            );

                            return (
                              <div
                                key={module.id}
                                className={`px-3 py-2 cursor-pointer hover:bg-gray-50 border-l-4 ${
                                  hasExistingTimer
                                    ? "border-l-orange-400 bg-orange-50"
                                    : "border-l-transparent"
                                }`}
                                onClick={() => handleModuleSelect(module.name)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div
                                      className={`font-medium text-sm ${
                                        hasExistingTimer
                                          ? "text-orange-900"
                                          : "text-gray-900"
                                      }`}
                                    >
                                      {module.name}
                                    </div>
                                    <div className="text-xs text-gray-500 truncate">
                                      {module.description}
                                    </div>
                                    {moduleUrlId && (
                                      <div className="text-xs text-blue-600 font-mono">
                                        Matches: {moduleUrlId}
                                      </div>
                                    )}
                                    {module.language && (
                                      <div className="text-xs text-green-600">
                                        {module.language}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {hasExistingTimer && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs bg-orange-100 text-orange-800"
                                      >
                                        {existingTimer?.timeLimit}m
                                      </Badge>
                                    )}
                                    {selectedModule === module.name && (
                                      <Check className="h-4 w-4 text-orange-600" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="px-3 py-2 text-sm text-gray-500">
                            No modules found
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Minutes"
                      value={timerMinutes}
                      onChange={(e) => setTimerMinutes(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={addModuleTimer}
                      className="bg-orange-600 hover:bg-orange-700 text-white"
                      disabled={!selectedModule || !timerMinutes}
                    >
                      {hasTimer(selectedModule) ? "Update" : "Set Limit"}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Monitoring Control */}
        <div className="flex flex-col items-center gap-4">
          {isMonitoring && logSourceInfo && (
            <Alert className="max-w-2xl border-amber-200 bg-amber-50 text-left">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-900 text-sm">
                <strong>Live log source unavailable.</strong>{" "}
                {logSourceInfo.reason} Rows here only appear when the server can
                stream real oc4d lines containing{" "}
                <code className="text-xs bg-white/80 px-1 rounded">/modules/</code>.
              </AlertDescription>
            </Alert>
          )}
          {stats.backgroundModuleMonitor && (
            <Alert className="max-w-2xl border-blue-200 bg-blue-50 text-left">
              <Database className="h-4 w-4 text-blue-700" />
              <AlertDescription className="text-blue-900 text-sm">
                <strong>Server-side monitor is on</strong> (
                <code className="text-xs">MODULEGAZE_BACKGROUND_MONITOR</code>
                ). Sessions and archives update without keeping this tab on the log
                stream; this page refreshes data from the server every few seconds.
              </AlertDescription>
            </Alert>
          )}
          <Button
            onClick={toggleMonitoring}
            size="lg"
            className={`${
              isMonitoring
                ? "bg-red-600 hover:bg-red-700"
                : "bg-orange-600 hover:bg-orange-700"
            } text-white px-8 py-3 text-lg`}
          >
            {stats.backgroundModuleMonitor ? (
              isMonitoring ? (
                <>
                  <Pause className="h-5 w-5 mr-2" />
                  Pause live view
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Resume live view
                </>
              )
            ) : isMonitoring ? (
              <>
                <Pause className="h-5 w-5 mr-2" />
                Stop Monitoring
              </>
            ) : (
              <>
                <Play className="h-5 w-5 mr-2" />
                Start Monitoring
              </>
            )}
          </Button>
        </div>

        {/* Active Module Timers */}
        {moduleTimers.filter((t) => t.isActive && t.moduleName !== "default")
          .length > 0 && (
          <Card className="border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-gray-900">
                Active Module Timers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {moduleTimers
                  .filter((t) => t.isActive && t.moduleName !== "default")
                  .map((timer, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-lg"
                    >
                      <div>
                        <div className="font-medium text-gray-900">
                          {timer.moduleName}
                        </div>
                        <div className="text-sm text-gray-600">
                          {timer.timeLimit} minute limit
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {/* <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleTimer(index)}
                          className="border-orange-300 text-orange-700 hover:bg-orange-100"
                        >
                          {timer.isActive ? "Pause" : "Resume"}
                        </Button> */}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => removeTimer(index)}
                          className="bg-red-100 text-red-700 hover:bg-red-200 border-red-300"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alerts */}
        {alerts.length > 0 && (
          <Alert className="border-red-200 bg-red-50">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              <div className="space-y-1">
                {alerts.slice(-3).map((alert, index) => (
                  <div key={index}>{alert}</div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* IP Module Time Tracking Table */}
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-bold text-gray-900">
              User &amp; module time tracking
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-4 font-semibold text-gray-700">
                      Name
                    </th>
                    <th className="text-left p-4 font-semibold text-gray-700">
                      IP address
                    </th>
                    <th className="text-left p-4 font-semibold text-gray-700">
                      Current module
                    </th>
                    <th className="text-right p-4 font-semibold text-gray-700">
                      Time spent
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {userSessions.map((session) => (
                    <tr
                      key={`${session.ip}\t${session.username}`}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="p-4">
                        {session.username === "Guest" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-600 italic font-medium">
                              Guest
                            </span>
                            <span className="font-mono text-sm text-gray-800">
                              {session.ip}
                            </span>
                          </div>
                        ) : (
                          <span className="font-medium text-gray-900">
                            {labelForSessionUser(session)}
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-blue-600 font-medium">
                          {session.ip}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-gray-900 font-medium">
                            {getDisplayName(session.module)}
                          </span>
                          {session.module !==
                            getDisplayName(session.module) && (
                            <span className="text-xs text-gray-500 font-mono">
                              ({session.module})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Badge
                            variant={
                              isSessionOverLimit(session)
                                ? "destructive"
                                : "secondary"
                            }
                            className={
                              isSessionOverLimit(session)
                                ? "bg-red-500 text-white border-red-600 font-semibold animate-pulse"
                                : "bg-gray-100 text-gray-700 border-gray-200"
                            }
                          >
                            {formatDuration(session.duration)}
                            {isSessionOverLimit(session) && " ⚠️"}
                          </Badge>
                          {getModuleTimeLimit(session.module) && (
                            <span className="text-xs text-gray-500">
                              Limit: {getModuleTimeLimit(session.module)}m
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {userSessions.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg">No active sessions</p>
                  <p className="text-sm text-gray-500">
                    {isMonitoring
                      ? "Waiting for oc4d log lines that match module URLs."
                      : "The log stream is not connected — use Start monitoring above."}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
