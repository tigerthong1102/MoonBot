# Workflow recovery

Before replacing a saved workflow, StartupBot stores its previous definition in
`skills-library/workflow-recovery/<id>.json` under the application's data
directory. A successful replacement or a verified rollback removes that file.
If an error reports a recovery ID, keep the file and back up the data directory
before attempting a repair. The file can contain conversation-derived data and
must be protected like the rest of the application's data.

The `workflow` field contains the previous definition; `name` and `place`
identify its former location. Inspect and restore a copy in an isolated
installation first. The normal Skill Burger save API refuses to replace a
workflow with an existing name; do not remove the current copy until its state
and the recovery file have been reviewed. Restoring on a Team Cloud requires
the same bot access and explicit sharing consent as saving a workflow.

On Team Cloud, bot-initiated workflow edits and undo are unavailable until the
initiating member's edit authority can be verified for the active turn. Use the
workflow controls with an account that can edit the bot. Sharing a workflow
requires explicit consent. These controls have been exercised with isolated
fixtures; production Team Cloud connectivity has not been verified.

Saved VM command steps are handed to the bot's normal VM tool instead of being
replayed automatically. The internal VM execution endpoint does not currently
prove that an aborted request stops its command, so automatic replay cannot
report a safe stop. The bot must report the actual result and must not retry an
uncertain command automatically.

Under a saved workflow’s step settings, a condition can use a field from an
earlier step. An independent group may run two to four explicitly recognized
Gmail or Google Calendar read operations together. Every read must pass the
current tool and connection permissions. A failed read stops the group before
any following action runs.

A step with an approval prompt pauses in its original conversation for up to
24 hours. A person with edit access can inspect the action and approve or
cancel. The pause and decision survive a server restart. Continuing requires
the same bot, conversation and enabled workflow revision, and runs through
the current tool permissions. Each approval applies to one step. If the server
stops after claiming an approved action, the chat marks the result as uncertain.
Reconcile it against the destination before starting a fresh workflow.
