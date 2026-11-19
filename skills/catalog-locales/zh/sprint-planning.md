使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# /冲刺计划

> 使用工作区为下面指定的数据源配置的连接器。如果连接器不可用，请请求导出。

通过确定工作范围、评估能力和设定明确的目标来计划冲刺。

## 用途

```
/sprint-planning $ARGUMENTS
```

## 它是如何运作的

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

## 我需要你做什么

- **团队**：团队中有谁以及他们在本次冲刺中的可用性？
- **冲刺长度**：多少天/周？
- **待办事项**：优先考虑什么？ （从跟踪器中拉出、粘贴或描述）
- **结转**：上一次冲刺有什么未完成的事情吗？
- **依赖关系**：其他团队有什么被阻止的吗？

## 输出

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

## 温馨提示

1. **保留缓冲区** — 计划为 70-80% 的容量。你会受到干扰。
2. **一个明确的冲刺目标** — 如果你不能用一句话来表达它，那么冲刺就没有重点。
3. **识别拉伸项目** — 如果事情花费的时间比预期长，知道要剪掉什么。
4. **诚实地延续** - 如果某些内容未交付，请在重新提交之前了解原因。
