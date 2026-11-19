使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# /衝刺計劃

> 使用工作區為下面指定的資料來源配置的連接器。如果連接器不可用，請要求匯出。

透過確定工作範圍、評估能力和設定明確的目標來規劃衝刺。

## 用途

```
/sprint-planning $ARGUMENTS
```

## 它是如何運作的

```
┌─────────────────────────────────────────────────────────────────┐
│                    SPRINT PLANNING                                 │
├─────────────────────────────────────────────────────────────────┤
│  STANDALONE (always works)                                       │
│  ✓ Define sprint goals and success criteria                     │
│  ✓ Estimate team capacity (accounting for PTO, meetings)        │
│  ✓ Scope and prioritize backlog items                           │
│  ✓ Identify dependencies and risks                              │
│  ✓ Generate sprint plan document                                │
├─────────────────────────────────────────────────────────────────┤
│  SUPERCHARGED (when you connect your tools)                      │
│  + Project tracker: Pull backlog, create sprint, assign items   │
│  + Calendar: Account for PTO and meetings in capacity           │
│  + Chat: Share sprint plan with the team                        │
└─────────────────────────────────────────────────────────────────┘
```

## 我需要你做什麼

- **團隊**：團隊中有誰以及他們在本次衝刺中的可用性？
- **衝刺長度**：幾天/週？
- **待辦事項**：優先考慮什麼？ （從追蹤器中拉出、貼上或描述）
- **結轉**：上次衝刺有什麼未完成的事嗎？
- **依賴關係**：其他團隊有什麼被阻止的嗎？

## 輸出

```markdown
## Sprint Plan: [Sprint Name]
**Dates:** [Start] — [End] | **Team:** [X] engineers
**Sprint Goal:** [One clear sentence about what success looks like]

### Capacity
| Person | Available Days | Allocation | Notes |
|--------|---------------|------------|-------|
| [Name] | [X] of [Y] | [X] points/hours | [PTO, on-call, etc.] |
| **Total** | **[X]** | **[X] points** | |

### Sprint Backlog
| Priority | Item | Estimate | Owner | Dependencies |
|----------|------|----------|-------|--------------|
| P0 | [Must ship] | [X] pts | [Person] | [None / Blocked by X] |
| P1 | [Should ship] | [X] pts | [Person] | [None] |
| P2 | [Stretch] | [X] pts | [Person] | [None] |

### Planned Capacity: [X] points | Sprint Load: [X] points ([X]% of capacity)

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | [What happens] | [What to do] |

### Definition of Done
- [ ] Code reviewed and merged
- [ ] Tests passing
- [ ] Documentation updated (if applicable)
- [ ] Product sign-off

### Key Dates
| Date | Event |
|------|-------|
| [Date] | Sprint start |
| [Date] | Mid-sprint check-in |
| [Date] | Sprint end / Demo |
| [Date] | Retro |
```

## 溫馨提示

1. **保留緩衝區** — 計劃為 70-80% 的容量。你會受到干擾。
2. **一個明確的衝刺目標** — 如果你不能用一句話來表達它，那麼衝刺就沒有重點。
3. **辨識伸展項目** — 如果事情花費的時間比預期長，知道要剪掉什麼。
4. **誠實地延續** - 如果某些內容未交付，請在重新提交之前了解原因。
