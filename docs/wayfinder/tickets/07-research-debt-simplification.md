---
title: Research debt simplification algorithms
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

Does the greedy two-pointer net-balance method give the minimum number of payments? What is known about minimising transactions, and which method should a group-sized (under 30 people) settlement use? Give a recommendation with a worked example.

## Resolution

The greedy two-pointer method is not minimal. Minimising payments is NP-hard (it equals partitioning balances into the most zero-sum groups; Verhoeff 2004, Pătcaş and Bartha), but the bound of at most N-1 payments holds. Worked example: A=-6, B=-5, C=+2, D=+4, E=+5, where greedy takes 4 payments and the optimum is 3 (checked with a throwaway script).

Recommendation: do not claim greedy minimises payments; state the guarantee as "at most N-1". Drop zero balances; if about 20 or fewer remain, run an exact zero-sum-partition search, otherwise fall back to greedy. Fix tie-breaks (amount descending, then member id) and use integer minor units only. Label the result "fewest payments" only when the exact path ran. Benchmark the exact search before relying on it at 30 members.

Unconfirmed: the Harvard thesis NP-completeness claim (the page returned HTTP 429) and the feasibility of an exact search at 30 members.

Findings: branch `research/research-debt-simplification` on origin, file `docs/research/research-debt-simplification.md` (throwaway, never merged).
