<img src="public/og.jpg" alt="Gaze open graph" align="center" />

# Module Gaze

This is an application that allows admins at the clc or centers to monitor the modules people are viewing in real-time.

It's running on the port `3002`.

## Overview

CDN Module Gaze monitors your existing `oc4d.service` logs in real-time to track user activity across different modules. It provides live statistics, time tracking per IP address, and configurable time limits with alerts when users exceed specified durations.

## Features

- 🔴 **Real-time Log Monitoring**: Streams live logs from `oc4d.service` using Server-Sent Events
- 📊 **Live Statistics**: Shows active users, modules, and session counts
- ⏱️ **Time Tracking**: Tracks how long each IP spends on each module (live seconds counter)
- 🚨 **Time Limits & Alerts**: Set time limits for specific modules with visual and alert notifications
- 🎯 **Smart Module Matching**: Links log module names to database module names using URL patterns
- 🧾 **Plain Log Files + Daily Zip Archives**: Writes human-readable `.log` files and zips prior days automatically
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🌙 **Modern UI**: Clean, professional interface with real-time updates

## How It Works

### 1. Log Monitoring Architecture

```ml
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ oc4d.service    │───▶│ journalctl -f    │───▶│ Next.js API     │
│                 │    │ (log streaming)  │    │ /api/logs/stream│
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                    │
                                                    ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Web Browser     │◀───│ Server-Sent      │◀───│ Log Parser      │
│ (React UI)      │    │ Events (SSE)     │    │ (IP + Module)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### 2. Log Parsing Process

The system monitors logs with this format:

```bash
Jul 02 03:13:12 cdn oc4d[2369]: info: ::ffff:192.168.4.238 - [2024-07-02T03:13:12.202Z] "GET /modules/cdn_acid_bases_and_salts/content/index.html HTTP/1.1" 200
```

**Extraction Process:**

1. **IP Address**: Extracts IPv4 from `::ffff:192.168.4.238` → `192.168.4.238`
2. **Module Name**: Extracts from URL `/modules/cdn_acid_bases_and_salts/...` → `cdn_acid_bases_and_salts`
3. **Session Tracking**: Links IP + Module to create/update user sessions

### 3. Module Matching System

The system uses a smart matching algorithm to link log module names with database module names:

```bash
Database Module:
├── name: "Acid, Bases, And Salts"
├── indexHtmlUrl: "/modules/cdn_acid_bases_and_salts/content/index.html"
└── URL ID: "cdn_acid_bases_and_salts" (extracted from indexHtmlUrl)

Log Entry:
├── URL: "/modules/cdn_acid_bases_and_salts/content/node/lesson1.html"
└── Module ID: "cdn_acid_bases_and_salts" (extracted from URL)

Match: ✅ URL ID === Module ID
```

### 4. Time Tracking & Limits

**Session Management:**

- One active session per IP address
- Sessions timeout after 5 minutes of inactivity
- Time tracking starts when module access is detected
- Live counter updates every second

**Timer System:**

- Set time limits for specific modules (by database name)
- Smart matching links timers to log sessions
- Visual indicators when limits are exceeded
- Configurable alerts and notifications

## Usage Guide

### 1. Starting Monitoring

1. Open the application in your browser
2. Click **"Start Monitoring"** button
3. The system begins streaming logs in real-time
4. Active sessions appear in the tracking table

### 2. Setting Time Limits

1. **Search for Module**: Use the dropdown to find a module
2. **Set Duration**: Enter time limit in minutes
3. **Activate Timer**: Click "Set Limit" to activate
4. **Monitor Status**: Active timers show in the dashboard

### 3. Monitoring Sessions

**Live Tracking Table shows:**

- IP addresses of active users
- Current module being accessed
- Live time counter (updates every second)
- Visual alerts when time limits exceeded

### 4. Understanding Alerts

When a user exceeds a time limit:

- Time badge turns red and pulses
- Alert notification appears at top
- Console logs violation details
- Session continues tracking (doesn't stop)

### 5. Log Files and Daily Archives

By default, Module Gaze writes logs under `/var/log/modulegaze` (override with `MODULEFETCH_LOG_DIR`):

- `modulegaze-access.log` (live day file; only when `MODULEGAZE_TEE_ACCESS_LOG=1`)
- `modulegaze-sessions.log` (live day file; session duration records)
- At the first write of a new day, yesterday's `.log` file is automatically zipped to:
  - `modulegaze-access-YYYY-MM-DD.log.zip`
  - `modulegaze-sessions-YYYY-MM-DD.log.zip`

Session lines are plain text (`tab` separated), for example:

```bash
2026-05-04T12:00:00.000Z	userId=teacher@example.com|192.168.1.20	moduleId=cdn_math	durationSeconds=305	schemaVersion=1
```

### 6. Recommended service env

Set these in `cdnmodulegaze.service` for production monitoring:

```bash
MODULEGAZE_BACKGROUND_MONITOR=1
MODULEGAZE_TEE_ACCESS_LOG=1
MODULEGAZE_JOURNAL_SINCE=today
MODULEFETCH_LOG_DIR=/var/log/modulegaze
MODULEGAZE_UPLOADS_MODULES_ROOT=/var/www/oc4d.cdn/uploads/modules
```

### 7. Raspberry Pi verification checklist

Run these checks on the Pi after deploy:

```bash
# 1) Reload service and restart
sudo systemctl daemon-reload
sudo systemctl restart cdnmodulegaze
sudo systemctl status cdnmodulegaze --no-pager

# 2) Confirm module API returns catalog + diagnostics
curl -s http://127.0.0.1:3002/api/modules

# 3) Confirm background monitor/log env values are active
sudo systemctl show cdnmodulegaze -p Environment

# 4) Watch live logs and verify identities are no longer Guest by default
sudo journalctl -u cdnmodulegaze -f

# 5) Verify plain logs are being written
sudo ls -lah /var/log/modulegaze
sudo tail -n 20 /var/log/modulegaze/modulegaze-access.log
sudo tail -n 20 /var/log/modulegaze/modulegaze-sessions.log
```

To validate daily zip rotation without waiting for midnight, stop the service, set one log file mtime to yesterday, then start service and trigger one new write; the previous-day file should be zipped automatically.

## Installation

To install CDN Module Gaze follow the commands below;

1. Connect the server to the internet and ssh into the server

    ```bash
    ssh pi@cdn.local
    ```

2. Clone the repo

    ```bash
    git clone https://github.com/ComDevNet/cdn-module-gaze.git 
    ```

    ```bash
    cd cdn-module-gaze
    ```

3. Run the Install script

    ```bash
    chmod +x install.sh
    ```

    ```bash
    ./install.sh
    ```

4. Now all you need to do is visit `http://oc4d.cdn:3002` and click on the `start monitoring` button

---

**Built with:** Next.js 14, React 18, TypeScript, Prisma, PostgreSQL, Tailwind CSS, shadcn/ui
