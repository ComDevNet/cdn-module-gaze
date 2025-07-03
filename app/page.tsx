"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Users, Database, AlertTriangle, Play, Pause, Settings, ChevronDown, Check } from "lucide-react"

interface UserSession {
  ip: string
  module: string
  startTime: Date
  duration: number
  lastActivity: Date
}

interface ModuleTimer {
  moduleName: string
  timeLimit: number // in minutes
  isActive: boolean
}

interface Stats {
  totalModules: number
  totalCategories: number
  uniqueUsersToday: number
  activeSessions: number
}

interface Module {
  id: string
  name: string
  description: string
  language: string
  indexHtmlUrl: string
  logoUrl: string
  categories: { name: string; description: string }[]
}

export default function CDNModuleMonitor() {
  const [userSessions, setUserSessions] = useState<UserSession[]>([])
  const [moduleTimers, setModuleTimers] = useState<ModuleTimer[]>([
    { moduleName: "default", timeLimit: 1, isActive: true }, // Default 1 minute limit
  ])
  const [stats, setStats] = useState<Stats>({
    totalModules: 0,
    totalCategories: 0,
    uniqueUsersToday: 0,
    activeSessions: 0,
  })
  const [alerts, setAlerts] = useState<string[]>([])
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [selectedModule, setSelectedModule] = useState("")
  const [timerMinutes, setTimerMinutes] = useState("")
  const [modules, setModules] = useState<Module[]>([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const eventSourceRef = useRef<EventSource | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Extract module name from URL path - updated for your log format
  const extractModuleName = (url: string): string | null => {
    // Handle URLs like "/modules/en-schools/content/node/typing_etc_streams_tfr2.html"
    const match = url.match(/\/modules\/([^/]+)/)
    if (match) {
      return match[1] // Returns "en-schools" from the example
    }

    // Also handle direct module references
    const directMatch = url.match(/\/modules\/([^/?]+)/)
    return directMatch ? directMatch[1] : null
  }

  // Parse log entry - updated for your specific log format
  const parseLogEntry = (logLine: string) => {
    try {
      // Your log format: Jul 02 03:13:12 cdn oc4d[2369]: info: ::ffff:192.168.4.238 - [2024-07-02T03:13:12.202Z] "GET /modules/en-schools/content/node/typing_etc_streams_tfr2.html HTTP/1.1" 200 - "http://oc4d.cdn/modules/en-schools/content/index.html" "Mozilla/5.0..."

      // Extract IP address - look for IPv4 pattern after "info:"
      const ipMatch = logLine.match(/info:\s*(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)/)

      // Extract URL from the GET request
      const urlMatch = logLine.match(/"GET\s+([^\s"]+)/)

      if (ipMatch && urlMatch) {
        const ip = ipMatch[1]
        const url = urlMatch[1]
        const moduleName = extractModuleName(url)

        if (moduleName) {
          console.log(`📋 Parsed: IP=${ip}, Module=${moduleName}, URL=${url}`)
          return { ip, module: moduleName }
        }
      }
    } catch (error) {
      console.error("Error parsing log line:", error)
    }
    return null
  }

  // Update user session
  const updateUserSession = (ip: string, module: string) => {
    setUserSessions((prev) => {
      const existingIndex = prev.findIndex((session) => session.ip === ip)
      const now = new Date()

      if (existingIndex >= 0) {
        const updated = [...prev]
        const existing = updated[existingIndex]

        if (existing.module !== module) {
          // User switched to a different module
          updated[existingIndex] = {
            ip,
            module,
            startTime: now,
            duration: 0,
            lastActivity: now,
          }
        } else {
          // Same module, just update last activity
          updated[existingIndex] = {
            ...existing,
            lastActivity: now,
          }
        }
        return updated
      } else {
        // New user session
        return [
          ...prev,
          {
            ip,
            module,
            startTime: now,
            duration: 0,
            lastActivity: now,
          },
        ]
      }
    })
  }

  const addModuleTimer = () => {
    if (selectedModule && timerMinutes) {
      const timer: ModuleTimer = {
        moduleName: selectedModule,
        timeLimit: Number.parseInt(timerMinutes),
        isActive: true,
      }
      setModuleTimers((prev) => {
        // Remove existing timer for this module if it exists
        const filtered = prev.filter((t) => t.moduleName !== selectedModule)
        return [...filtered, timer]
      })
      setSelectedModule("")
      setTimerMinutes("")
      setSearchTerm("")
      setIsDropdownOpen(false)
    }
  }

  // Check for timer violations
  const checkTimerViolations = () => {
    userSessions.forEach((session) => {
      const timer = moduleTimers.find((t) => t.moduleName === session.module && t.isActive)
      const defaultTimer = moduleTimers.find((t) => t.moduleName === "default" && t.isActive)
      const limit = timer ? timer.timeLimit : defaultTimer ? defaultTimer.timeLimit : 1

      if (session.duration > limit) {
        const alertMessage = `⚠️ IP ${session.ip} has exceeded ${limit} minutes on module "${session.module}"`
        setAlerts((prev) => {
          if (!prev.includes(alertMessage)) {
            return [...prev, alertMessage]
          }
          return prev
        })
      }
    })
  }

  // Clean up inactive sessions (no activity for 5 minutes)
  const cleanupInactiveSessions = () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    setUserSessions((prev) => prev.filter((session) => session.lastActivity > fiveMinutesAgo))
  }

  // Update session durations
  useEffect(() => {
    const interval = setInterval(() => {
      setUserSessions((prev) =>
        prev.map((session) => ({
          ...session,
          duration: Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60), // minutes
        })),
      )

      // Clean up inactive sessions
      cleanupInactiveSessions()
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Check timer violations periodically
  useEffect(() => {
    const interval = setInterval(checkTimerViolations, 5000)
    return () => clearInterval(interval)
  }, [userSessions, moduleTimers])

  // Start/Stop monitoring
  const toggleMonitoring = async () => {
    if (isMonitoring) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      setIsMonitoring(false)
    } else {
      try {
        const eventSource = new EventSource("/api/logs/stream")
        eventSourceRef.current = eventSource

        eventSource.onmessage = (event) => {
          const logData = JSON.parse(event.data)
          const parsed = parseLogEntry(logData.line)

          if (parsed) {
            updateUserSession(parsed.ip, parsed.module)
          }
        }

        eventSource.onerror = (error) => {
          console.error("EventSource failed:", error)
          setIsMonitoring(false)
        }

        setIsMonitoring(true)
      } catch (error) {
        console.error("Failed to start monitoring:", error)
      }
    }
  }

  // Format duration for display
  const formatDuration = (minutes: number) => {
    if (minutes < 1) {
      return `${Math.floor(minutes * 60)}s`
    } else if (minutes < 60) {
      return `${Math.floor(minutes)}m ${Math.floor((minutes % 1) * 60)}s`
    } else {
      const hours = Math.floor(minutes / 60)
      const mins = Math.floor(minutes % 60)
      return `${hours}h ${mins}m`
    }
  }

  // Check if session exceeds time limit
  const isSessionOverLimit = (session: UserSession) => {
    const timer = moduleTimers.find((t) => t.moduleName === session.module && t.isActive)
    const defaultTimer = moduleTimers.find((t) => t.moduleName === "default" && t.isActive)
    const limit = timer ? timer.timeLimit : defaultTimer ? defaultTimer.timeLimit : 1
    return session.duration > limit
  }

  // Get unique active modules
  const getActiveModules = () => {
    const modules = new Set(userSessions.map((session) => session.module))
    return modules.size
  }

  // Fetch modules from API
  const fetchModules = async () => {
    try {
      const response = await fetch("/api/modules")
      const data = await response.json()
      setModules(data)
    } catch (error) {
      console.error("Failed to fetch modules:", error)
    }
  }

  // Fetch initial stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/stats")
        const data = await response.json()
        setStats(data)
      } catch (error) {
        console.error("Failed to fetch stats:", error)
      }
    }

    fetchStats()
    fetchModules()
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  // Update stats based on current sessions
  useEffect(() => {
    const uniqueIPs = new Set(userSessions.map((session) => session.ip))
    setStats((prev) => ({
      ...prev,
      uniqueUsersToday: uniqueIPs.size,
      activeSessions: userSessions.length,
    }))
  }, [userSessions])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  // Filter modules based on search term
  const filteredModules = modules.filter(
    (module) =>
      module.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      module.description.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // Check if module has a timer set
  const hasTimer = (moduleName: string) => {
    return moduleTimers.some((timer) => timer.moduleName === moduleName && timer.moduleName !== "default")
  }

  // Get existing timer for module
  const getExistingTimer = (moduleName: string) => {
    return moduleTimers.find((timer) => timer.moduleName === moduleName && timer.moduleName !== "default")
  }

  const handleModuleSelect = (moduleName: string) => {
    setSelectedModule(moduleName)
    setSearchTerm(moduleName)
    setIsDropdownOpen(false)

    // If module already has a timer, populate the time field
    const existingTimer = getExistingTimer(moduleName)
    if (existingTimer) {
      setTimerMinutes(existingTimer.timeLimit.toString())
    } else {
      setTimerMinutes("")
    }
  }

  const toggleTimer = (index: number) => {
    setModuleTimers((prev) => {
      const updatedTimers = [...prev]
      updatedTimers[index].isActive = !updatedTimers[index].isActive
      return updatedTimers
    })
  }

  const removeTimer = (index: number) => {
    setModuleTimers((prev) => {
      const updatedTimers = [...prev]
      updatedTimers.splice(index, 1)
      return updatedTimers
    })
  }

  return (
    <div className="min-h-screen bg-gray-50 p-9">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-5xl font-bold text-orange-600">CDN Module Gaze</h1>
          <p className="text-xl text-gray-600">Live monitoring of CDN module usage and anomaly detection.</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-700">Live Users</CardTitle>
                <Users className="h-5 w-5 text-orange-500" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-4xl font-bold text-gray-900 mb-1">{stats.uniqueUsersToday}</div>
              <p className="text-sm text-gray-500">Unique IPs currently active</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-700">Active Modules</CardTitle>
                <Database className="h-5 w-5 text-orange-500" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-4xl font-bold text-gray-900 mb-1">{getActiveModules()}</div>
              <p className="text-sm text-gray-500">Unique modules being accessed</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-gray-700">Module Time Limits</CardTitle>
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
                          setSearchTerm(e.target.value)
                          setIsDropdownOpen(true)
                        }}
                        className="flex-1 outline-none bg-transparent"
                        onFocus={() => setIsDropdownOpen(true)}
                      />
                      <ChevronDown
                        className={`h-4 w-4 text-gray-400 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
                      />
                    </div>

                    {isDropdownOpen && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                        {filteredModules.length > 0 ? (
                          filteredModules.map((module) => {
                            const hasExistingTimer = hasTimer(module.name)
                            const existingTimer = getExistingTimer(module.name)

                            return (
                              <div
                                key={module.id}
                                className={`px-3 py-2 cursor-pointer hover:bg-gray-50 border-l-4 ${
                                  hasExistingTimer ? "border-l-orange-400 bg-orange-50" : "border-l-transparent"
                                }`}
                                onClick={() => handleModuleSelect(module.name)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div
                                      className={`font-medium text-sm ${
                                        hasExistingTimer ? "text-orange-900" : "text-gray-900"
                                      }`}
                                    >
                                      {module.name}
                                    </div>
                                    <div className="text-xs text-gray-500 truncate">{module.description}</div>
                                    {module.language && <div className="text-xs text-blue-600">{module.language}</div>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {hasExistingTimer && (
                                      <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800">
                                        {existingTimer?.timeLimit}m
                                      </Badge>
                                    )}
                                    {selectedModule === module.name && <Check className="h-4 w-4 text-orange-600" />}
                                  </div>
                                </div>
                              </div>
                            )
                          })
                        ) : (
                          <div className="px-3 py-2 text-sm text-gray-500">No modules found</div>
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
        <div className="flex justify-center">
          <Button
            onClick={toggleMonitoring}
            size="lg"
            className={`${
              isMonitoring ? "bg-red-600 hover:bg-red-700" : "bg-orange-600 hover:bg-orange-700"
            } text-white px-8 py-3 text-lg`}
          >
            {isMonitoring ? (
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
        {moduleTimers.filter((t) => t.isActive && t.moduleName !== "default").length > 0 && (
          <Card className="border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-gray-900">Active Module Timers</CardTitle>
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
                        <div className="font-medium text-gray-900">{timer.moduleName}</div>
                        <div className="text-sm text-gray-600">{timer.timeLimit} minute limit</div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleTimer(index)}
                          className="border-orange-300 text-orange-700 hover:bg-orange-100"
                        >
                          {timer.isActive ? "Pause" : "Resume"}
                        </Button>
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
            <CardTitle className="text-2xl font-bold text-gray-900">IP Module Time Tracking</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-4 font-semibold text-gray-700">IP Address</th>
                    <th className="text-left p-4 font-semibold text-gray-700">Current Module</th>
                    <th className="text-right p-4 font-semibold text-gray-700">Time Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {userSessions.map((session, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4">
                        <span className="font-mono text-blue-600 font-medium">{session.ip}</span>
                      </td>
                      <td className="p-4">
                        <span className="text-gray-900 font-medium">{session.module}</span>
                      </td>
                      <td className="p-4 text-right">
                        <Badge
                          variant={isSessionOverLimit(session) ? "destructive" : "secondary"}
                          className={
                            isSessionOverLimit(session)
                              ? "bg-red-100 text-red-800 border-red-200"
                              : "bg-gray-100 text-gray-700 border-gray-200"
                          }
                        >
                          {formatDuration(session.duration)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {userSessions.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Database className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg">No active sessions</p>
                  <p className="text-sm">Start monitoring to see live user activity</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
