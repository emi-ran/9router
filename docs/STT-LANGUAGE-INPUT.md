# Codex transcription language input

The optional STT language hint accepts an empty value (automatic detection) or
two ASCII letters, such as `tr` or `en`. Uppercase codes are normalized to lowercase.

During editing, incomplete or invalid values remain editable and show an inline
validation message. The curl preview, Copy curl and Run actions are unavailable
until the value is valid. Request helpers retain strict validation; partial
input must never reach the API or throw from the component's render path.
