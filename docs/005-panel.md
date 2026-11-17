# 005 Panel

Open **Superagent** in the DeepSeek Harness Web sidebar to supervise the agent. The panel prioritizes work that needs a person, then system health and history. This document builds on [000 Philosophy](000-philosophy.md) through [004 Prompts](004-prompts.md).

## Three questions

Opening the panel answers three questions, in this order:

1. Does anything need me now?
2. Is the system healthy and doing the right things?
3. What is the history of one piece of work, from Trigger through Eval to Ticket?

## Tabs

The tabs follow the workflow: **Overview**, **Source**, **Trigger**, **Eval**, **Execution**, **Console** and **Settings**. Until repository and account setup succeeds, Overview shows what is missing and links to the relevant setting.

| Tab | Shows |
| --- | --- |
| Overview | Tickets needing action, system problems, activity counts for the last 24 hours, and Executor load. Each block links to its detailed page |
| Source | Source state, setup problems and non-zero counts. Filtered Triggers and dropped messages cover the same 24-hour window as Overview |
| Trigger | Threads filtered by Subscribed, Evaluating, New Triggers in 24 h, or All Threads. Each Thread shows its Triggers newest first, Decisions and Subscriptions |
| Eval | Decisions with their reason and matched rules |
| Execution | Executor state, Pause processing, and Tickets filtered by Open, Pending, Working, Waiting for a Trigger or Ended. Ticket details show actions, authorization, waiting Inputs, Subscriptions and Assignments |
| Console | The dispatch as it happens, opening with one line that says, worst first, where it is stuck (processing paused, a Source down, every Executor slot busy with a queue, Tickets waiting for a person, replies not yet sent) or what it is working on: Executor load, queue, Tickets waiting on people, pending replies and the last hour's throughput; the pipeline with live counts, each step and the edge into it lighting as work passes through; a Ticket's call chain (its pipeline steps and each tool call, with the time between them) from its lane or any log line; a lane per Executor slot and the main Session with what each runs now (tool and command, secrets masked), with Open Session and Stop; Source and service health; and the live event stream, which a person can pause, filter by step or topic, and export |
| Settings | Sources, Eval, Execution, Prompts and Deployment, under the dispatch pipeline map. Each group includes its save history |

### Reading individual records

A Ticket or Thread opened from a list opens in a drawer on the right, over the list, which keeps what it loaded and where it was scrolled. A Ticket's Trigger or Thread opens in the same drawer, with back stepping inside it; Escape or the close button returns to the list, and **Open as a full page** turns the drawer into a page. Below 900 px a detail takes the whole page.

A dropped message links to its Ticket, or to its Thread when it has no Ticket. The Source page explains whether its conversation disappeared or the Source stopped listening to it.

A human follow-up still owned by an Executor is marked **Delivered to Ticket**, without an Eval. The Thread also shows hand-back reasons and context-only Subscriptions. **Evaluate again** can send that follow-up to Eval, or retry a Trigger with no effective judgement: one filtered by its Source, an unavailable Eval, or a delivered message with neither a non-stop Decision nor an Executor acknowledgement.

Ticket details show the originating Trigger, Decision and reason, scope and Policy version. Assignments and secondary details are folded below the immediate actions. **Retry** is available for failed Input delivery or a Ticket waiting for a person after a blocked or failed Report. Ended Tickets show outcomes such as **Pull request merged** or **Stopped by a person**.

## Settings groups

- **Sources:** one card per Source with its switch, fields and verified account facts. GitHub also offers receive-all switches for new Issues, pull requests, comments and default-branch CI. Polling and read limits are under Advanced.
- **Architecture map:** over every group but Deployment, the path of a message as five steps (Sources, Policy & admission, main Session, Executors, Replies), and under each step the components it holds, read from the saved settings: each Source instance, the Policy rules and admission, each role's model, agent preset, capability packs and prompt, the Executor's slots and environment. The steps the open group configures are outlined; focusing a field, or opening a prompt part, lights the step and the component it bears on and names the block, field and line under the map. Clicking a step opens its settings; clicking a component opens its group, scrolls to it and focuses it.
- **Eval:** the Policy version and rules, followed by **On each Source** and the Eval settings. Each Source tab contains its allowed list, membership sync, admission table and bot list. Sync runs at startup and on **Sync now**. The admission table distinguishes receiving scope, sender membership and whether the message addresses the agent. Eval settings select the accept mode, timeout, assessment model and the main Session's agent preset.
- **Execution:** worker model, concurrency, the Executor's agent preset, directory root, prepare command and blocked commands. Clicking an available variable, or typing `$` in the prepare command, inserts it; a blocked command becomes a chip once a space, comma or Enter follows it.
- **Capability packs:** over its agent preset, each role turns on several packs at once, in order (drag, or Alt + arrow keys; Delete removes one). A pack takes tools away, grants tools DSH has registered beyond the role's own (an MCP server's or a plugin's, by name; a name DSH has not registered has no effect), and adds standing instructions, applied in order so a later pack decides a tool two packs name; the bundle ships a few read-only ones, and **Manage packs** writes, copies, imports and exports the team's own. Under the chain the role's effective tools show live, those a pack took away struck through with its name, and a set the role cannot work under (an Executor without read, bash, or both write and edit; a main Session without read or bash) is refused with why. Packs apply to Sessions created after the save; their instructions reach every Session at its next request.
- **Presets:** the panel names a role's layers as one idea. The DSH agent preset is the role's **base preset** (底座预设); the team's capability packs are its **presets** (预设), which a person writes, copies, imports and exports, turns on several at once and orders. The prompt presets both roles share are chosen on the same page, several at once and in order, and a change there saves at once and rolls back with a notice when the save fails.
- **Base presets:** each role picks one card among the presets DSH offers, or names another by id. A preset a role cannot run under is shown disabled with why (the router preset cannot write files for an Executor; the worker preset does not route waits for the main Session). Under any preset but the bundle's, an Executor's tools are still cut down to its work tools and the main Session keeps the stricter wait guard. A new preset applies to Sessions created after the save.
- **Prompts:** the **Prompt presets** bar turns several presets on at once, in order; it reorders by drag or Alt + arrow keys, and **Manage presets** writes, copies, imports and exports the team's own. **Assembly** (组装) draws one role's final prompt as a vertical stack of layers in the order its Session reads them: the built-in parts, the team's sections, each preset's text apart from the team's (a section a preset appends to is two layers), the capability packs' instructions after the prompt, then the skills it loads by name. Each layer is as wide as its text and coloured by who wrote it (built in, team, each preset its own colour, packs striped); the stack follows the unsaved draft. Clicking a layer opens its editor beside the stack: a team section or built-in part edits the prompt draft, a preset's layer edits that preset in the library and a pack's layer that pack's instructions, each saved at once on its own revision (the bundle's presets and packs open read-only). **Edit** changes team sections, built-in parts and skills in a code editor with line numbers, Markdown highlighting and placeholder marks; the parts a preset writes carry its colour. **Full prompt** shows the assembled text and compares it with saved text or defaults. **History** lists versions. Edited built-in parts are marked changed and can be reset; templates list their required placeholders.

  An upgrade that changes an overridden default marks it **Default updated** (默认内容已更新). The panel compares the old and new defaults above the team's text. If the old default was not recorded, it compares the team's text with the new default instead. Choose **Keep my text** or **Use the new default**. Overrides for removed parts are listed below the tab bar and dropped on the next save.
- **Deployment:** startup problems with **Check again**, the state directory and machine limits. Saved limits apply without restart. The DeepSeek Harness Plugin Manager exposes the same page.

The GitHub repository table is a settings block like the others: its edits are a draft kept in the tab, saved with the shared save bar, merged with a concurrent save, and a save applies the repositories in place without restarting dsh-superagent. A row may be a pattern such as `owner/**`, which stays one row and is matched live, so repositories created later join on their next mention or within 30 minutes; the table's switches set what every repository receives.

## Live updates

The panel streams the host's live feed (`GET events`), which also carries each Engine domain event as a `stage` at its pipeline step: a Store write or an agent's activity reloads the views showing it at once, and they poll only every minute to stay consistent. The header says **Live**, **Connecting** or **Polling**; while the stream is down the views poll every 5 seconds, and it reconnects by itself, resuming after the last event it read. The full prompt composes 0.4 seconds after the last edit and drops a request a newer edit made moot.

## Search

The header search finds Triggers by text, id, Feishu message id or a stored link, such as a GitHub comment URL. A Feishu link missing from the original message becomes searchable only after the host reads it during the current process lifetime.

Search also finds Threads by references such as `#12` or a GitHub URL, and Tickets by title or a matching Thread. It searches a quarter second after typing stops; Enter searches at once.

The command palette (⌘K or Ctrl+K, or `/` outside a field) opens any page or settings group, the main Session, and pauses or resumes processing.

## Principles

1. **Focus on what matters.** Every element answers one of the three questions, or it is removed. A number appears only when it changes what the supervisor does.
2. **Precise definitions.** Categories have checkable definitions, are mutually exclusive and cover every case, as the Ticket stages do. A label says whom a row waits for and what it needs, not an internal status code.
3. **One place per concept.** Source state belongs in Source; Threads and Triggers in Trigger; Decisions in Eval; Tickets in Execution. Settings are grouped by the concept they configure. Overview summarizes these pages and links to them instead of becoming another detailed view.
4. **Domain structure.** The panel uses the domain terms. Internal identifiers appear only in folded details, and names replace identifiers where they can be resolved.
5. **Honest state.** A count equals the length of the list it links to, and no state contradicts another fact.
6. **Quiet by default.** Healthy states take no extra space. Problems must be actionable; a one-off network error is not enough. Rows needing a person offer their action directly. Keep page explanations to one sentence and put further detail in the (?) tooltip. Destructive actions require confirmation.
7. **Consistent controls.** Use DeepSeek Harness design tokens and control behavior. The same information should look the same throughout the panel. Each settings block has one save bar, visible only while changes exist, a save runs or a save fails.
