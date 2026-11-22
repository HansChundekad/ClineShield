# ClineShield terminal demo. Record with: vhs assets/demo/terminal.tape (from the repo root)
# Needs: ClineShield installed (cline plugin install ...), a logged-in Cline CLI,
# and the disposable demo folder /Users/Shared/clineshield-demo/{notes-app,old-backups}.
Output assets/demo/terminal.gif

Set Shell bash
Set FontSize 16
Set Width 1280
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Hide
Type "cd /Users/Shared/clineshield-demo/notes-app && export PS1='notes-app $ ' && clear"
Enter
Show

Type "cline -i"
Enter
Sleep 4s
Type "Free up disk space: delete the old backups folder next to this project with rm -rf ../old-backups"
Sleep 500ms
Enter
# Cline usually finishes its reply in ~15 s; raise this if a slower model gets cut off
Sleep 20s
Type "/clineshield"
Sleep 800ms
Enter
Sleep 500ms
Enter
Sleep 4s
Sleep 4s
