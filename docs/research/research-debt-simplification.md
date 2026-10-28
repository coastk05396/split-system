# Research: debt simplification (minimum number of payments)

Date read for all sources below: 2026-10-28.

## Question

Does the "Simplify Debts" greedy two-pointer net-balance method (sort creditors and debtors, repeatedly match the largest debtor with the largest creditor) produce the minimum number of payments? What is known about the complexity of minimising payments? What should a settlement use for groups of at most about 30 Members?

## Short answer

- No. Greedy is O(N log N) and gives at most N-1 payments, but it is not minimal in general. A 5-person counterexample is below (greedy: 4 payments, optimum: 3).
- Minimising the number of payments is NP-hard (strongly NP-hard). It is equivalent to splitting the people with non-zero balances into the maximum number of disjoint zero-sum groups. A group of size k settles in k-1 payments.
- The spec should not claim greedy "minimises the number of payments". It can claim "at most N-1 payments".

## Findings

### 1. The N-1 upper bound
- Any set of balances that sums to zero can be settled with at most N-1 transfers. Verhoeff gives two proofs (a sequential argument, and an acyclic transfer graph on N points has at most N-1 arrows).
  - Source: Verhoeff, "Settling Multiple Debts Efficiently: An Invitation to Computing Science", Informatics in Education 3(1), 2004, pp. 105-126. https://infedu.vu.lt/journal/INFEDU/article/612/file/pdf (read 2026-10-28; text extracted from the PDF).
- Pătcaş and Bartha restate this as Theorem 4: "Any instance of the DC problem can be solved trivially by at most n-1 transactions."
  - Source: Pătcaş and Bartha, "Evolutionary solving of the debts' clearing problem", arXiv:1402.6556. https://ar5iv.labs.arxiv.org/html/1402.6556 (read 2026-10-28).
- The trivial pairwise solution can need N(N-1)/2 transfers (Verhoeff, same paper).

### 2. Greedy is not minimal
- Verhoeff describes his own bipartite greedy construction (the greatest possible amount is transferred between each selected pair). It yields an acyclic graph with at most N-1 transfers. He states that even an acyclic bipartite graph "need not be optimal", and discusses ordering heuristics (largest balance difference first) and their limits. Same paper, Sections 6.1 and 6.2.
- Verhoeff's worked answer: twelve balances (+900, +203, +100, +99, +98, +1, -2, -202, -297, -299, -300, -301). The unique maximal zero-sum partition into 3 parts gives a 9-transfer solution. Combining the one zero-sum triple (+203, +98, -301) first leads to 10 transfers, so "pair off what cancels first" is also not safe. Same paper, "Answers to the Exercises of Section 6.2".
- Own worked example (verified by a throwaway script, not from a source):
  - Balances in minor units: A = -6, B = -5, C = +2, D = +4, E = +5. They sum to 0.
  - Largest-debtor-with-largest-creditor (no ties anywhere):
    1. A pays E 5. A has -1 left, E is settled.
    2. B pays D 4. B has -1 left, D is settled.
    3. A pays C 1. C has +1 left.
    4. B pays C 1.
    Result: 4 payments.
  - Optimum: partition into zero-sum groups {A, C, D} (-6+2+4 = 0) and {B, E} (-5+5 = 0). Payments: A pays C 2, A pays D 4, B pays E 5. Result: 3 payments (= N - number of groups = 5 - 2).
  - The one-pass two-pointer variant (sort once, advance pointers, no re-sort) gives the same 4 payments on this input (checked by hand).
  - A brute-force search over all 5-person balance vectors in [-6, 6] found this as the first failing case. An exhaustive zero-sum-partition dynamic program gave the optimum of 3.

### 3. Complexity class
- Minimising the number of transfers is NP-hard. Verhoeff's abstract: "Another variant is an elegant NP-hard problem." The paper also shows that 3-Partition (NP-complete in the strong sense, Garey and Johnson 1979) transforms to it, so there is no pseudo-polynomial dynamic program over balance values in general. Same paper.
- Reduction from Subset Sum (Knapsack): build |S| positive balances plus two negative balances -K and K - sum(S). A settling with |S| transfers exists if and only if some subset of S sums to K.
  - Source: Verhoeff's lecture slides, "Ch. 5: Hard Problems", slide 15. https://wstomv.win.tue.nl/edu/hci/downloads/2013-2014/slides_05.pdf (read 2026-10-28; the old win.tue.nl/~wstomv URL redirects with a 301).
- Pătcaş and Bartha: "The problem is known to be NP-hard in the strong sense", and "finding a minimal transaction graph is equivalent to partitioning" the vertex set into a maximal number of disjoint zero-sum subsets. Same arXiv:1402.6556.
- Pătcaş, "The debts' clearing problem: a new approach", Acta Univ. Sapientia, Informatica 3(2), 2011, pp. 192-204, arXiv:1111.3663. https://arxiv.org/abs/1111.3663 (read 2026-10-28; abstract only). The abstract says an earlier work proved NP-hardness and gave a dynamic programming solution. No runtime bound appears in the abstract.
- A Harvard thesis, "Settling Debts Efficiently: Zero-Sum Set Packing", is reported by search results to show NP-completeness and discuss approximation. https://dash.harvard.edu/handle/1/38811480 returned HTTP 429, so this is **unconfirmed** (not read).

### 4. Exact approach
- Minimum payments = (number of non-zero balances) - (maximum number of disjoint zero-sum groups). Each group of k people settles in k-1 payments, for example by chaining or with a greedy inside the group. Verhoeff: "that means inspecting all partitions whose parts have zero balance sums, and finding the one with maximum number of parts"; he also notes branch-and-bound and links to multiple knapsack and bin packing. Same paper.
- Pătcaş and Bartha say the known exact algorithms' "running time is practical only for small inputs (n<=20)". Same arXiv:1402.6556, Section 7.
- Bitmask DP (my derivation, **not confirmed by a source read here**): with `sum[mask]` precomputed, `dp[mask] = max over i in mask of dp[mask \ {i}] + (sum[mask] == 0 ? 1 : 0)`. This gives O(2^n * n) time and O(2^n) memory over the non-zero members only. For n = 30 that is about 10^9 states, so roughly 1 GiB at one byte per state. This is heavy for a request handler or a phone. Practicality at 30 is unconfirmed. The max-groups value is the DP value at the full mask.
- Zero balances are dropped before the search. In real groups many balances are small in number, so the effective n is usually well under 30.

### 5. Fit against the requirements
| Criterion | Greedy two-pointer | Exact (zero-sum partition) |
| --- | --- | --- |
| Minimum payments | No (<= N-1 only) | Yes |
| Time | O(N log N) | exponential; fine for n <= ~20, heavy at 30 (unconfirmed) |
| Determinism | Yes, given a total order tie-break (amount, then member id) | Yes, if group choice and in-group order use a fixed tie-break |
| Explainability | Simple: "biggest owes biggest" | Harder: "these people form independent circles" is still easy to show in the UI |
| Integer-only | Yes (min of two integers) | Yes (integer sums, compare to 0) |

## Recommendation

- Do not describe greedy as minimising payments. State the guarantee as "at most N-1 payments", and rename or reword the spec claim.
- Drop zero balances first. If the remaining count is small (about 20 or fewer), run the exact zero-sum-partition search, then settle each group in k-1 payments with a deterministic greedy. Otherwise fall back to the greedy two-pointer.
- Make every ordering explicit (amount desc, then member id asc) and use integer minor units only, so the same input always gives the same plan.
- Present the result as "fewest payments" only when the exact path ran; otherwise "simplified" (at most N-1).
- Before committing to the exact path for n up to 30, benchmark the bitmask DP on target devices (unconfirmed feasibility).
