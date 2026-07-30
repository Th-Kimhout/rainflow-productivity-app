# Software Requirement Specification (SRS) & System Architecture
## Project Name: RainFlow (Personal Productivity Platform)
**Version:** 1.0  
**Author:** Rain  
**Date:** July 2026  
**Status:** Architecture & Requirements Draft  

---

> [!IMPORTANT]
> **Partially superseded.** §1.4, §2.1, §2.2, §3.4, §3.5, §6, §7.2 and §8 have been revised during
> implementation planning. See [`adr/0001-deviations-from-prd.md`](adr/0001-deviations-from-prd.md)
> for the authoritative record — **where it disagrees with this document, it wins.**
>
> Headline changes: **Supabase, not Neon**; **no Prisma**; sync goes browser↔PostgREST directly
> rather than through Server Actions; Supabase Auth + RLS replaces `PERSONAL_APP_SECRET`; and the
> §6 schema is revised in ~15 places, several because it could not express what §3 promises.
>
> §1 (vision), §3 (features), §4 (UX/UI) and §5 (workflows) remain accurate apart from the scope
> reductions listed in the ADR.

---

## 1. Executive Summary & Vision

### 1.1 Overview
**RainFlow** is a tailored, high-performance personal productivity web application engineered specifically for a single user (Rain). Designed to eliminate friction, cognitive overload, and context switching, RainFlow integrates fast task management, timeboxing, habit tracking, deep focus timers, personal knowledge linking, and weekly productivity analytics into a unified, zero-cost web platform.

### 1.2 Core Principles
1. **Zero-Friction Execution:** Sub-second interactions, universal hotkey capture, and instantaneous in-memory local feedback.
2. **Offline-First & Resilient:** Fully functional without active network connectivity, leveraging local storage caching to eliminate cloud server cold-start delays.
3. **Intentional Simplicity:** Single-user scope ($N=1$) eliminates multi-tenant database complexity, granular RBAC permissions, and team billing bloat.
4. **Zero Cloud Infrastructure Cost:** Optimized to run entirely within lifetime free tier limits across Vercel, Neon PostgreSQL, and GitHub.

---

## 2. System Architecture & Tech Stack

### 2.1 Architectural Paradigm
RainFlow adopts a **Serverless Full-Stack Monorepo Architecture** using Next.js (App Router). The browser acts as an intelligent execution engine featuring local-first caching via Dexie.js (IndexedDB). Data mutations sync asynchronously to a serverless backend powered by Next.js Server Actions and Prisma ORM, connected to a serverless Neon PostgreSQL cluster.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Engine (Browser)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                Next.js React Client State                │  │
│  └────────────────────────────┬─────────────────────────────┘  │
│                               │ Instant Sync / Read            │
│  ┌────────────────────────────▼─────────────────────────────┐  │
│  │              Local Caching Engine (IndexedDB)            │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Async Network Sync (Server Actions)
┌───────────────────────────────▼─────────────────────────────────┐
│               Serverless API Layer (Vercel Edge/Node)            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            Next.js App Router (Server Actions)           │  │
│  └────────────────────────────┬─────────────────────────────┘  │
│                               │ Prisma ORM (Pooled Connection)  │
┌───────────────────────────────▼─────────────────────────────────┐
│                 Data Tier (Neon Serverless Postgres)            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Layer | Technology | Selection Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | **Next.js 14+ (App Router)** | Server Components, Server Actions, optimal bundle size, edge routing. |
| **Language** | **TypeScript** | Strict end-to-end type safety between database, API, and UI components. |
| **Styling & UI** | **Tailwind CSS + Shadcn UI** | High performance, accessible component primitives, utility-first dark mode. |
| **Icons & Visuals** | **Lucide React** | Featherweight SVG icon library optimized for modern web apps. |
| **Local Persistence** | **Dexie.js (IndexedDB wrapper)** | Instant page loads, offline-first data retention, zero cold-start latency. |
| **Database ORM** | **Prisma ORM** | Schema migrations, auto-generated TypeScript client, safe connection pooling. |
| **Primary Database** | **Neon PostgreSQL** | Serverless Postgres free tier with automated branching and HTTP pooling. |
| **Hosting Platform** | **Vercel** | Free global edge deployment, native Next.js integration, zero server ops. |

---

## 3. Detailed System Features

### 3.1 Universal Quick Capture & Natural Language Input
* **Global Hotkey Overlay:** Pressing `Cmd/Ctrl + K` opens a floating command dialog from anywhere in the application.
* **NLP Date & Tag Parsing:** Input engine automatically parses natural language:
  * Example: `"Complete API documentation tomorrow at 3pm #project @high"` -> Parses Title: `Complete API documentation`, Due Date: `Tomorrow 15:00`, Tag: `#project`, Priority: `High`.
* **Smart Fallbacks:** Tasks without explicit tags/dates default to the "Inbox" view without blocking user focus.

### 3.2 Dynamic Task Management & Context Views
* **Eisenhower Priority Matrix:** Categorizes tasks into four quadrant grids:
  1. Urgent & Important (Do First)
  2. Not Urgent & Important (Schedule)
  3. Urgent & Not Important (Delegate / Automate)
  4. Not Urgent & Not Important (Eliminate)
* **Timeboxing Calendar:** Drag-and-drop tasks directly into a visual 24-hour time-grid to lock in daily execution commitments.
* **Subtask Tree & Dependencies:** Support for breakdown hierarchies with nested checkboxes and progress tracking bars.

### 3.3 Deep Focus Engine (Pomodoro & Zen Mode)
* **Zen Mode UI:** Isolates a single active task, hiding sidebars, navigation bars, and distracting UI elements.
* **Customizable Timer:** Configurable focus/break cycles (default: 25 min work, 5 min break, 15 min long break after 4 cycles).
* **Audio & Visual Cues:** Subtle notification sound and browser tab progress indicator (`(18:24) Focus: RainFlow PRD`).

### 3.4 Habit Tracking & Routine Building
* **Streak Maintenance:** Track daily/weekly recurring routines (e.g., "Read 30 mins", "Daily Code Review").
* **Flexible Recurrence Engine:** Rules for `Daily`, `Weekdays`, `Interval (Every X days)`, or `Nth day of month`.
* **Habit Matrix Grid:** Heatmap chart visualizer inspired by GitHub contribution graphs.

### 3.5 Personal Knowledge & Context Linking
* **In-Line Document Notes:** Markdown editor built into task inspector drawers.
* **Bi-Directional References:** Link tasks to related reference notes or external resources (`[[Note Title]]` or external URLs).
* **Code & Snippet Attachments:** Embedded code blocks with syntax highlighting directly attached to tasks.

### 3.6 Focus Analytics & Performance Insights
* **Planned vs. Actual Time Tracking:** Log precise execution duration via focus timer vs. initial timeboxing estimates.
* **Energy Level Logging:** Quick 1-click rating post-task (High / Medium / Low focus) mapped against time of day.
* **Weekly Review Digest:** Automated weekly summary displaying total focus hours completed, task velocity, habit consistency percentage, and top focus hours.

---

## 4. User Experience (UX) & Interface (UI) Design Specification

### 4.1 Design Philosophy & Aesthetics
RainFlow adheres to an **Atmospheric Minimalist** visual language. Dark mode is prioritized to minimize eye strain during extended coding and planning sessions.

* **Color Palette (Slate & Rain Accent):**
  * Base Background: `#0f172a` (Slate 900) / Card Surface: `#1e293b` (Slate 800)
  * Border Colors: `#334155` (Slate 700)
  * Primary Accent: `#38bdf8` (Sky 400 - "Rain Blue")
  * Secondary Accent: `#818cf8` (Indigo 400)
  * Success / Active: `#34d399` (Emerald 400)
  * Priority High: `#f87171` (Red 400)
* **Typography:** Clean sans-serif system font stack (`Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`).
* **Layout Structure:**
  * Left Collapsible Sidebar (Navigation & Filters)
  * Main Content Canvas (Dynamic view: Board, List, Matrix, Calendar)
  * Right Inspector Drawer (Task details, notes, subtasks, activity log)

### 4.2 Keyboard Navigation Blueprint
RainFlow is 100% operable without mouse interaction:

| Hotkey | Global Action |
| :--- | :--- |
| `Cmd / Ctrl + K` | Open Universal Quick Capture / Command Palette |
| `G + T` | Navigate to **Today / Timebox** View |
| `G + E` | Navigate to **Eisenhower Matrix** View |
| `G + H` | Navigate to **Habits** View |
| `G + A` | Navigate to **Analytics** View |
| `C` | Create New Task in current view |
| `F` | Toggle Focus / Zen Mode for selected task |
| `Esc` | Close Modal / Inspector Drawer |

---

## 5. System Workflows & User Journey

### 5.1 Daily Planning & Execution Flow

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Morning Alignment                                         │
│    - Open RainFlow (Instant local loading via IndexedDB)     │
│    - Review Unprocessed Inbox via Quick Capture              │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ 2. Prioritization & Timeboxing                               │
│    - Drag tasks into Eisenhower Matrix                       │
│    - Drag matrix items into Today's Timebox calendar slots   │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ 3. Deep Execution                                            │
│    - Select target task -> Hit 'F' for Zen Mode              │
│    - Start integrated Pomodoro timer                          │
│    - Capture unexpected distractions using Quick Capture     │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ 4. Evening Closure & Review                                  │
│    - Check off completed habits                              │
│    - Log task energy rating                                  │
│    - View automatically calculated daily velocity report     │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Database Schema Specification (Prisma Definition)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum MatrixQuadrant {
  DO_FIRST
  SCHEDULE
  DELEGATE
  ELIMINATE
}

enum TaskStatus {
  INBOX
  BACKLOG
  TODAY
  IN_PROGRESS
  COMPLETED
  ARCHIVED
}

model Task {
  id              String          @id @default(uuid())
  title           String
  description     String?         @db.Text
  status          TaskStatus      @default(INBOX)
  priority        Priority        @default(MEDIUM)
  quadrant        MatrixQuadrant?
  estimatedMins   Int?
  actualMins      Int?            @default(0)
  dueDate         DateTime?
  timeboxStart    DateTime?
  timeboxEnd      DateTime?
  isCompleted     Boolean         @default(false)
  completedAt     DateTime?
  energyRating    String?         // "HIGH", "MEDIUM", "LOW"
  
  // Relations
  parentId        String?
  parent          Task?           @relation("TaskSubtasks", fields: [parentId], references: [id], onDelete: Cascade)
  subtasks        Task[]          @relation("TaskSubtasks")
  
  tags            TaskTag[]
  focusSessions   FocusSession[]
  
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([status, dueDate])
  @@index([quadrant])
}

model Tag {
  id        String    @id @default(uuid())
  name      String    @unique
  color     String    @default("#38bdf8")
  tasks     TaskTag[]
}

model TaskTag {
  taskId    String
  tagId     String
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  tag       Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([taskId, tagId])
}

model Habit {
  id            String        @id @default(uuid())
  title         String
  description   String?
  frequency     String        // "DAILY", "WEEKDAYS", "WEEKLY"
  targetDays    Int           @default(1)
  color         String        @default("#34d399")
  logs          HabitLog[]
  createdAt     DateTime      @default(now())
}

model HabitLog {
  id          String   @id @default(uuid())
  habitId     String
  habit       Habit    @relation(fields: [habitId], references: [id], onDelete: Cascade)
  completedAt DateTime @default(now())

  @@index([habitId, completedAt])
}

model FocusSession {
  id          String   @id @default(uuid())
  taskId      String?
  task        Task?    @relation(fields: [taskId], references: [id], onDelete: SetNull)
  durationMin Int
  notes       String?
  completedAt DateTime @default(now())
}
```

---

## 7. Non-Functional Requirements & Security

### 7.1 Performance Benchmarks
* **First Contentful Paint (FCP):** < 400ms (served directly from local IndexedDB cache).
* **Command Palette Latency:** < 50ms lookup time across all stored tasks.
* **Sync Overhead:** Background network synchronization completed within 1.5s of reconnection.

### 7.2 Security & Authentication
* **Single-User Access Guard:** Protected via secure HTTP-only cookie with secret token verification or environment variable middleware match (`PERSONAL_APP_SECRET`).
* **Environment Isolation:** Zero public write endpoints without authorization headers.
* **Automated Database Backups:** Daily logical backups generated via Neon point-in-time recovery.

---

## 8. Deployment & Continuous Integration Blueprint

1. **Repository Setup:** GitHub private repository (`rainflow-web`).
2. **CI/CD Pipeline:** Vercel GitHub Integration for automatic zero-downtime deployment on main branch push.
3. **Database Migration Pipeline:** Automatic execution of `npx prisma migrate deploy` during Vercel build phase.
