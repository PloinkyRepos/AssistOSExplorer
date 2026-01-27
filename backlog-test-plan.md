# Backlog Manual Test Plan

## Scope
Manual validation for backlog discovery, creation, task CRUD, filters, carousel, conflict handling, and UI behaviors.

## Preconditions
- Workspace running on `http://127.0.0.1:8082`.
- At least one repo in `.ploinky/repos/` (e.g. `testRepo`).
- tasksAgent and gitAgent running.

## Legend
- **Expected**: required result.
- **If fails**: what to inspect/log.

---

## 1) Backlog discovery + empty state

### 1.1 No backlog files
1. Open Explorer for a repo with **no** `*.backlog` files.
2. Click **Backlog** (`#tasksButton`).

**Expected**
- Message: no backlog found.
- Create backlog modal opens with filename input.

**If fails**
- Check console for `search_files` result.

### 1.2 Create backlog file (custom name)
1. Enter `team.backlog` and click **Create**.

**Expected**
- File appears in tree.
- Backlog panel opens for that file.
- Header shows `Backlog` + `team.backlog`.

---

## 2) Backlog file selection

### 2.1 Multiple backlog files
1. Ensure 2 files: `team.backlog` and `qa.backlog`.
2. In tree, open each file.

**Expected**
- Header updates to active filename.
- Tasks list shows only tasks from that file.

---

## 3) Task creation

### 3.1 Create task (minimal)
1. Open **New task**.
2. Fill **Description** only.
3. Create.

**Expected**
- Task appears in carousel.
- Status/type/priority use defaults.

### 3.2 Create task (full)
1. Fill Description, Proposed solution, Observations, Type, Status, Priority.
2. Create.

**Expected**
- All fields saved and displayed.

---

## 4) Task editing

### 4.1 Edit fields inline
1. Edit Description / Proposed Solution / Observations.
2. Move focus away.

**Expected**
- Values persist after refresh.

### 4.2 Quick actions
1. Use quick **Approve** / **Reopen** (or other available quick actions).

**Expected**
- Status updates.
- Observations can be edited in reopened/rejected states.

### 4.3 Type & priority menus
1. Click type icon dropdown and change type.
2. Change priority from its menu.

**Expected**
- Changes persist.

---

## 5) Filters

### 5.1 Status/type/priority filters
1. Set each filter to a value.

**Expected**
- List filters immediately.

### 5.2 Search filter
1. Search text present in Description.
2. Search text present in Observations.

**Expected**
- Matches found in both fields.

### 5.3 Clear filters
1. Click **Clear**.

**Expected**
- All filters reset.
- Full list returns.

---

## 6) Carousel

1. With >=2 tasks, click **Prev** / **Next**.

**Expected**
- Index updates correctly (e.g., `1 / 3`, `2 / 3`).

---

## 7) Conflict detection (same task)

### 7.1 Two tabs conflict
1. Open same backlog file in two tabs.
2. Edit task in Tab A and save.
3. Edit same task in Tab B without refresh and save.

**Expected**
- Tab B shows conflict modal with **Current vs Yours**.
- “Save my changes” overwrites; Cancel keeps current.

---

## 8) Conflict detection (different tasks)

1. Edit task A in Tab A.
2. Edit task B in Tab B.

**Expected**
- No conflict (different tasks).

---

## 9) Git interactions (should NOT auto-commit)

1. Create/edit tasks.
2. Open Git status.

**Expected**
- `.backlog` modified in repo status.
- No automatic commit/push triggered.

---

## 10) UI state

### 10.1 Conflict lock
1. Force a merge conflict in `.backlog`.
2. Open backlog panel.

**Expected**
- Conflict banner visible.
- Inputs disabled until conflict resolved.

### 10.2 Header filename
1. Switch between backlog files.

**Expected**
- Header filename updates each time.

---

## 11) Error handling

1. Try editing without selecting a backlog file (if panel opened from other context).

**Expected**
- Clear error: “Select a .backlog file...”.

---

## 12) Regression: WebSkel compliance

1. Click any backlog modal header “X”.

**Expected**
- Modal closes.
- No stray click handlers or manual binding errors.

