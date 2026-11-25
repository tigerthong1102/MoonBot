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
