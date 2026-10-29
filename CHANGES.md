# Changes inspired by ego-lite

This documents what was learned from [citrolabs/ego-lite](https://github.com/citrolabs/ego-lite) and the fixes made along the way.

ego-lite is a full browser driven through a JavaScript helper API, while A-eye is a browser extension driven through MCP or a CLI. Only the ideas that fit an extension were ported.

## Ideas ported from ego-lite

| Idea in ego-lite | What A-eye does now |
|---|---|
| Agents compose many steps into one script, so the context is not re-sent after every click | `aeye run` runs an async JS script with helpers `nav read act shot js logs tabs gif` and `sleep(ms)`. Loops and conditions are allowed, and only what the script prints comes back. Over MCP it is opt-in with `AEYE_RUN=1`. |
| Several actions per round trip | `act steps='[{...},{...}]'` runs up to 20 actions in one call, stops at the first failure and reports only the last step's page state. |
| Popup waiting and tab awareness | Tabs opened by an action (`target=_blank`, `window.open`) are reported as `opened tab N` and added to the Agent tab group. |
| Wait on observable conditions, not delays | `act a=wait` accepts `gone:` to wait for text or a `css:` selector to disappear (spinners, toasts, modals). |
| Skill guidance for agents | `skill/SKILL.md` now covers cheap observation, waiting on conditions, batching, checking the page before retrying, working in opened tabs and stopping when done. |
| Consistent paging of large snapshots | Later pages of a long `read` come from the first page's cached output, so offsets stay consistent and the DOM is not walked again. |

## Bugs fixed

- **`nav read=true` after a navigation** could return only a "changes since last read" diff against the previous page, so the agent never saw the new page's elements. A diff is now used only on the same origin and path.
- **`fill` on a `<select>`** fired the `change` event twice. It now fires once.

## Performance and cleanup

- Paginated `read` no longer re-walks the DOM for each page.
- The screenshot throttle was lowered from 600 ms to 520 ms, just above Chromium's 2 captures per second limit.
- Result rendering (saving screenshots to a temp file) is shared between `aeye call` and `aeye run` in `resultText`.

## Not done

- Taking visible-tab screenshots through the debugger, which would avoid the rate limit and the need to bring the tab to the front.
- Reducing `getComputedStyle` cost during `read` on very large pages.
- Download tracking, which needs the extra `downloads` permission.

## Verification

`npm run check`, `npm test` (6 tests) and `npm run build` pass. The extension changes were not exercised in a live browser, and `aeye run` was checked against a stub client only.
