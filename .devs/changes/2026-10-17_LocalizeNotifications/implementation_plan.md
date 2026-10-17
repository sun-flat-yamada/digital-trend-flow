# Localize notification text and send Slack mrkdwn (#58)

Slack receives raw Markdown (`**bold**`, `[text](url)` and `##` are not Slack mrkdwn), Slack and Teams cut the body at a fixed character count, and the Discord / Slack / Teams / email boilerplate is fixed in Japanese or English whatever `OUTPUT_LANGUAGE` is (PUB-5).

## User Review Required
> [!IMPORTANT]
> The notification boilerplate (the "read the full report" notice, "Processed N articles", the email subject, badge and footer) follows the report's language: Japanese for `ja`, English otherwise. Only Discord is configured in production today, so Discord's notice becomes English unless `OUTPUT_LANGUAGE=ja`.

> [!WARNING]
> No live webhook is available in the session; Slack mrkdwn is verified by unit tests against Slack's documented syntax only.

## Proposed Changes
### Shared
#### [NEW] [src/publishing/notify_common.ts](../../../src/publishing/notify_common.ts)
- `notifyStrings(language)`: localized boilerplate (ja / en).
- `truncateAtSection(text, max, notice)`: cut at the last `---` / heading / blank line before the limit, append the notice, never exceed `max`.
- `markdownToSlackMrkdwn(markdown)`: `&<>` escaped, links → `<url|text>`, bold → `*text*`, italic → `_text_`, headings → bold lines, `-` / `*` bullets → `•`, `---` → a divider line.
### Notifiers
#### [MODIFY] [src/publishing/slack_notifier.ts](../../../src/publishing/slack_notifier.ts)
- Convert to mrkdwn, truncate at a section boundary within the 3,000-character section limit, localized context line.
#### [MODIFY] [src/publishing/discord_notifier.ts](../../../src/publishing/discord_notifier.ts), [src/publishing/teams_notifier.ts](../../../src/publishing/teams_notifier.ts), [src/publishing/email_notifier.ts](../../../src/publishing/email_notifier.ts)
- Take the report language; shared truncation and localized text.
#### [MODIFY] [src/core/builtin_plugins.ts](../../../src/core/builtin_plugins.ts)
- Pass `payload.language` to the notifiers.
### Docs
- `docs/improvement-plan.md` (PUB-5), `docs/settings.md` (language-controlled stages).

## Verification Plan
### Automated Tests
- Quality gate.
- New `tests/notifiers.test.ts`: mrkdwn conversion, section-boundary truncation and limits, localized text for ja / en in the Discord, Slack and Teams payloads (axios mocked).
- `tests/email_notifier.test.ts`: localized subject and body.
### Manual Verification
- None (no webhooks in the session).
