---
name: Technical-office product scope
description: The user's role and intended audience for the technical-office app.
---

The user is a technical-office manager at a company. They want a shared app for the office's projects, assigning tasks to technical-office engineers, and tracking progress.

Only the owner's designated account should have the manager role. The manager creates each engineer's username and password; there is no public self-signup or email invitation flow.

**Why:** The user stated this as the core purpose of the app and chose manager-created username/password accounts over email invitations.

**How to apply:** Keep future product work focused on the manager-and-engineer workflow for the user's technical office, with one designated manager and manager-controlled engineer accounts, rather than broadening it into generic project management.

Task actions should have visible text labels and progress changes should be
available after opening a task, without opening the general edit form.

**Why:** The user asked: «خلى كل زراير الاوبشن بتاع المهمة واظحة بدون الدخول على التعديل».

**How to apply:** Preserve direct progress controls and clearly named actions
inside the expanded task; do not require editing the task to change progress.

Task lists should be compact, consecutive points showing only the task name,
project name, and assignee. Other information appears when the task is pressed.

**Why:** The user asked: «اسم المهمة واسم المشروع ، واسم المسئول ، واى داتا تانية تبان لما اظغط علي المهمة ... موجز وباين فى صورة نقاط متتالية».

**How to apply:** Keep collapsed rows limited to those three fields; put dates,
status, description, and actions in the expanded task instead of crowding the list.

The application should focus on tasks: what is finished and what remains.
Project start/end dates and project delivery deadlines are not important to the
user's workflow; projects primarily group the tasks.

**Why:** The user said: «المشروع كبداية ونهاية مش مهم ولا مهم معاد تسليمه ... الهدف اصلا انى اركز على المهام وايه اللي خلص منها وايه اللي لسه باقي».

**How to apply:** Prioritize task completion, remaining work, and task progress
in navigation, dashboards, and project summaries rather than project schedules.

Task file uploads should be separate from the task conversation.

**Why:** The user asked: «فى النقاش محتاج افصل ماكن رفع الملفات عن الشات».

**How to apply:** Keep task files and chat in clearly separate sections when
changing the discussion interface.

Project managers may receive read-only follow-up links covering either all
projects or one or more selected projects, showing tasks, assignees, progress,
and files without settings or any create, edit, or delete capability.

**Why:** The user requested external follow-up access and explicitly expanded
the scope to «كل المشاريع ... او احدد مشروع واحد بس او اكتر».

**How to apply:** Preserve per-link project scope and server-enforced read-only
access. Do not treat a follow-up link as an office membership or login session.
