import {
  type CurrencyCode,
  formatAmount,
  type Group,
  type PlannedPayment,
  type Settlement,
} from "@split/shared";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, MessageCircle, Send } from "lucide-react";
import { useDeps } from "../app/AppProviders.js";
import {
  AvatarTip,
  card,
  failureMessage,
  LoadError,
  Loading,
  secondaryButton,
} from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { dateHeading, memberPictures } from "../expenses/ExpenseList.js";
import { localName } from "../i18n/format.js";
import { useEnsureInvite, useMembers } from "../groups/api.js";
import { useIsUpdating } from "../groups/cache-persistence.js";
import { LineShareUnavailableError } from "../platform/line.js";
import { CountUp } from "../shell/CountUp.js";
import { SproutMascot, Sparkles } from "../shell/SproutMascot.js";
import { useBalances, useRecordSettlement, useSettlementAction, useSettlements } from "./api.js";
import { BalanceChart } from "./BalanceChart.js";
import { ConfirmSettlementDialog } from "./ConfirmSettlementDialog.js";
import { type BalanceRow, canConfirm, canUndo, maxPayable } from "./model.js";
import { buildSettleCard, settleFlexMessage, settleText } from "./settle-card.js";
import { usePaymentPlan } from "./use-payment-plan.js";

/** Each Member's picture by id, for the avatars deep inside the payment cards. */
const PictureContext = createContext<(id: string) => string | null>(() => null);

/** How many past Settlements show at first, and how many more each 查看更多 adds. */
const HISTORY_STEP = 5;

/**
 * Screen 5 as amended (decisions 12, 17, 23): my Balance, the Payment plan with its honest
 * label, per-payment confirm actions (確認付款 for the payer, 確認收款 for the receiver or an
 * Admin) and the Settlement history with undo and the 已撤銷 line. Everything is in the Group's
 * Settlement currency, and the Payment plan always matches the confirmed Balances.
 */
export function SettlePanel({ group }: { group: Group }) {
  const balances = useBalances(group.id);
  const settlements = useSettlements(group.id);
  const isUpdating = useIsUpdating(["groups", group.id, "balances"]);
  const plan = usePaymentPlan(
    balances.data?.balances.map((b) => ({ memberId: b.memberId, amountMinor: b.balance })),
  );
  const action = useSettlementAction(group.id);
  // Whether there was anything to settle while this screen was open: only then is "all settled"
  // news worth a ring, rather than the calm state of a group that never owed anything.
  const sawWork = useRef(false);
  const members = useMembers(group.id);
  const [shareNotice, setShareNotice] = useState<{ text: string; isError: boolean } | null>(null);

  if (balances.isError) {
    return <LoadError error={balances.error} onRetry={() => void balances.refetch()} />;
  }
  if (settlements.isError) {
    return <LoadError error={settlements.error} onRetry={() => void settlements.refetch()} />;
  }
  if (balances.isPending || settlements.isPending) return <Loading />;

  const currency = balances.data.settlementCurrency;
  const rows = new Map(balances.data.balances.map((b) => [b.memberId, b]));
  const nameOf = (id: string) => localName(rows.get(id)?.displayName ?? "?");
  const mine = rows.get(group.me.memberId)?.balance ?? 0;
  const all = settlements.data.pages.flatMap((p) => p.settlements);
  const history = all.filter((s) => s.status !== "pending");
  const planned = plan.status === "ready" ? plan.plan.payments : [];
  // Show the full Group Payment plan so it always sums to the Balance chart above; payments
  // involving me sort first, followed by payments between other Members.
  const orderedPlan = [
    ...planned.filter((p) => involvesMe(group, p)),
    ...planned.filter((p) => !involvesMe(group, p)),
  ];
  if (mine !== 0 || orderedPlan.length > 0) sawWork.current = true;

  return (
    <PictureContext value={memberPictures(members.data)}>
      <div className="flex flex-col gap-4 text-ink">
        <BalanceChart
          rows={balances.data.balances}
          myMemberId={group.me.memberId}
          currency={currency}
          pictureOf={memberPictures(members.data)}
          updating={isUpdating}
        />

        {action.isError && (
          <p role="alert" className="text-red-700">
            {failureMessage(action.error)}
          </p>
        )}

        <section className="settle-stagger-2 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-lg font-bold">{t("settle.planTitle")}</h2>
            {/* Only an approximate plan says so; the fewest-payments one needs no label. */}
            {plan.status === "ready" &&
              plan.plan.payments.length > 0 &&
              plan.plan.method !== "exact" && (
                <span className="rounded-full bg-peach px-3 py-1 text-xs font-bold text-sprout-700">
                  {t("settle.label.greedy", { count: plan.plan.maxPayments })}
                </span>
              )}
            {plan.status === "ready" && orderedPlan.length > 0 && (
              <SettleNotifyActions
                group={group}
                payments={orderedPlan}
                currency={currency}
                nameOf={nameOf}
                onNotice={(text, isError = false) => {
                  setShareNotice({ text, isError });
                }}
              />
            )}
          </div>
          {shareNotice !== null && (
            <p
              role={shareNotice.isError ? "alert" : "status"}
              className={`text-right text-xs font-bold ${shareNotice.isError ? "text-red-700" : "text-sprout-700"}`}
            >
              {shareNotice.text}
            </p>
          )}
          {plan.status === "computing" && <Loading />}
          {plan.status === "failed" && (
            <p role="alert" className="text-red-700">
              {t("settle.planFailed")}
            </p>
          )}
          {plan.status === "ready" &&
            (orderedPlan.length === 0 ? (
              <SettledMessage celebrate={sawWork.current} />
            ) : (
              <ul aria-label={t("settle.planTitle")} className="flex flex-col gap-2">
                {orderedPlan.map((p) => (
                  <li key={`${p.fromMemberId}-${p.toMemberId}`} className={paymentCard()}>
                    <PlannedRow
                      group={group}
                      payment={p}
                      rows={rows}
                      currency={currency}
                      updating={isUpdating}
                    />
                  </li>
                ))}
              </ul>
            ))}
        </section>

        {history.length > 0 && (
          <SettlementHistory
            group={group}
            history={history}
            nameOf={nameOf}
            currency={currency}
            undoDisabled={action.isPending}
            onUndo={(settlementId) => {
              action.mutate({ kind: "undo", settlementId });
            }}
            more={
              settlements.hasNextPage ? (
                <button
                  type="button"
                  className={`${secondaryButton} py-3`}
                  disabled={settlements.isFetchingNextPage}
                  onClick={() => void settlements.fetchNextPage()}
                >
                  {t("expense.more")}
                </button>
              ) : null
            }
          />
        )}
      </div>
    </PictureContext>
  );
}

function lineShareLink(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

function SettleNotifyActions({
  group,
  payments,
  currency,
  nameOf,
  onNotice,
}: {
  group: Group;
  payments: readonly PlannedPayment[];
  currency: CurrencyCode;
  nameOf: (id: string) => string;
  onNotice: (text: string, isError?: boolean) => void;
}) {
  const { line } = useDeps();
  const invite = useEnsureInvite(group.id);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("touchstart", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("touchstart", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  async function prepareCard() {
    const link = await invite.mutateAsync().catch(() => null);
    return buildSettleCard(payments, group, currency, nameOf, link?.token ?? null);
  }

  async function sendToChat() {
    if (busy) return;
    setBusy(true);
    try {
      const card = await prepareCard();
      try {
        await line.sendToChat([settleFlexMessage(card)]);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.log("[DEV] sendToChat simulated:", settleFlexMessage(card));
        } else {
          throw err;
        }
      }
      onNotice(t("settleShare.sentToChat"));
    } catch (error) {
      onNotice(failureMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function shareLine() {
    if (busy) return;
    setBusy(true);
    let card: ReturnType<typeof buildSettleCard> | null = null;
    try {
      card = await prepareCard();
      const sent = await line.shareMessages([settleFlexMessage(card)], { stayOpen: true });
      if (sent) onNotice(t("settleShare.sharedLine"));
    } catch (error) {
      if (card !== null && error instanceof LineShareUnavailableError) {
        window.location.assign(lineShareLink(settleText(card)));
        return;
      }
      onNotice(failureMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        disabled={busy}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => {
          setMenuOpen((o) => !o);
        }}
        className="press-pill flex items-center gap-1.5 rounded-full border border-sprout-200 bg-peach px-3.5 py-1.5 text-xs font-bold text-sprout-700 shadow-2xs hover:border-sprout-500 disabled:opacity-60"
      >
        <MessageCircle aria-hidden="true" className="size-3.5 text-sprout-700" />
        <span>{t("settleShare.menuTrigger")}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-3 text-sprout-700 transition-transform duration-180 ease-(--ease-spring) ${
            menuOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="glass-dialog surface-card absolute right-0 z-20 mt-1.5 flex w-40 flex-col gap-1 rounded-2xl border border-sprout-200/90 bg-white/95 p-1.5 shadow-lg backdrop-blur-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void sendToChat();
            }}
            className="press-pill flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-ink hover:bg-sprout-100"
          >
            <Send aria-hidden="true" className="size-3.5 text-sprout-600" />
            {t("settleShare.sendToChat")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void shareLine();
            }}
            className="press-pill flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-ink hover:bg-sprout-100"
          >
            <MessageCircle aria-hidden="true" className="size-3.5 text-sprout-600" />
            {t("settleShare.shareLine")}
          </button>
        </div>
      )}
    </div>
  );
}

function SettledMessage({ celebrate }: { celebrate: boolean }) {
  return (
    <div className="relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-[1.75rem] bg-sprout-150 px-4 py-6 font-bold text-sprout-700">
      {celebrate && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <span className="leaf-particle p1" />
          <span className="leaf-particle p2" />
          <span className="leaf-particle p3" />
          <span className="leaf-particle p4" />
          <span className="leaf-particle p5" />
          <span className="leaf-particle p6" />
        </div>
      )}
      <span aria-hidden="true" className="relative inline-flex">
        {celebrate && (
          <span className="settle-ring absolute inset-2 rounded-full border-2 border-sprout-500" />
        )}
        <span className={`relative inline-flex ${celebrate ? "settle-pop" : ""}`}>
          <Sparkles>
            <SproutMascot className="size-24" mood="cheer" />
          </Sparkles>
        </span>
      </span>
      <p>{t("settle.allSettled")}</p>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** When it happened: confirmed, undone or cancelled at; the day it was made as a last resort. */
function eventAt(s: Settlement): Date {
  const at =
    s.status === "confirmed"
      ? (s.confirmedAt ?? s.createdAt)
      : s.status === "undone"
        ? (s.undoneAt ?? s.updatedAt)
        : s.status === "cancelled"
          ? s.updatedAt
          : s.createdAt;
  return new Date(at);
}

function dayOf(s: Settlement): string {
  const d = eventAt(s);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeOf(s: Settlement): string {
  const d = eventAt(s);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One past Settlement on a single line: who paid whom, the amount, and what may be done. */
function HistoryRow({
  settlement: s,
  group,
  nameOf,
  currency,
  dropped,
  undoDisabled,
  onUndo,
}: {
  settlement: Settlement;
  group: Group;
  nameOf: (id: string) => string;
  currency: CurrencyCode;
  dropped: boolean;
  undoDisabled: boolean;
  onUndo: (id: string) => void;
}) {
  const me = group.me.memberId;
  const payer = nameOf(s.payerMemberId);
  const receiver = nameOf(s.receiverMemberId);
  const label = (id: string, name: string) => (id === me ? t("settle.you") : name);
  return (
    <li
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-sprout-150 py-2 last:border-b-0 ${dropped ? "opacity-60" : ""}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <Person id={s.payerMemberId} name={payer} isMe={s.payerMemberId === me} />
        <ArrowRight className="size-4 shrink-0 text-ink-muted" />
        <Person id={s.receiverMemberId} name={receiver} isMe={s.receiverMemberId === me} />
      </span>
      <span className="sr-only">
        {t("settle.pays", {
          payer: label(s.payerMemberId, payer),
          receiver: label(s.receiverMemberId, receiver),
        })}
      </span>
      <span
        className={`shrink-0 font-bold tabular-nums ${dropped ? "text-ink-muted line-through" : "text-sprout-600"}`}
      >
        {formatAmount(s.amount, currency)}
      </span>
      {dropped && (
        <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-bold text-ink-muted">
          {t(statusLabel(s))}
        </span>
      )}
      {s.status === "confirmed" && canUndo(group.me, s) && (
        <button
          type="button"
          className="rounded-full border border-sprout-200 px-3 py-1 text-xs font-bold"
          disabled={undoDisabled}
          onClick={() => {
            onUndo(s.id);
          }}
        >
          {t("settle.undo")}
        </button>
      )}
      <span className="w-full pl-0.5 text-xs text-ink-muted">{timeOf(s)}</span>
    </li>
  );
}

/**
 * 結算紀錄: one line per confirmed Settlement under a heading for its day, the latest few first
 * with 查看更多 for the rest; the cancelled and undone ones, which move no Balance, stay folded.
 */
function SettlementHistory({
  group,
  history,
  nameOf,
  currency,
  undoDisabled,
  onUndo,
  more,
}: {
  group: Group;
  history: readonly Settlement[];
  nameOf: (id: string) => string;
  currency: CurrencyCode;
  undoDisabled: boolean;
  onUndo: (id: string) => void;
  more: ReactNode;
}) {
  const [visible, setVisible] = useState(HISTORY_STEP);
  const [droppedVisible, setDroppedVisible] = useState(HISTORY_STEP);
  const [showDropped, setShowDropped] = useState(false);
  const confirmed = history.filter((s) => s.status === "confirmed");
  const dropped = history.filter((s) => s.status !== "confirmed");
  const rowProps = { group, nameOf, currency, undoDisabled, onUndo };

  /** One grey heading per day, and a one-line row for each Settlement of that day. */
  const byDay = (list: readonly Settlement[], isDropped: boolean): ReactNode[] => {
    const items: ReactNode[] = [];
    let lastDay = "";
    for (const s of list) {
      const day = dayOf(s);
      if (day !== lastDay) {
        lastDay = day;
        items.push(
          <li key={`day-${day}-${s.id}`} role="presentation" className="pt-3 first:pt-0">
            <h3 className="rounded-xl bg-sprout-150 px-3 py-1 text-sm font-bold text-ink-muted">
              {dateHeading(day)}
            </h3>
          </li>,
        );
      }
      items.push(<HistoryRow key={s.id} settlement={s} dropped={isDropped} {...rowProps} />);
    }
    return items;
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{t("settle.historyTitle")}</h2>
      <ul aria-label={t("settle.historyTitle")} className="flex flex-col">
        {byDay(confirmed.slice(0, visible), false)}
      </ul>
      {confirmed.length > visible && (
        <button
          type="button"
          className={`${secondaryButton} py-3`}
          onClick={() => {
            setVisible(visible + HISTORY_STEP);
          }}
        >
          {t("settle.historyMore")}
        </button>
      )}
      {dropped.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showDropped}
            className="flex items-center gap-1 self-start text-sm font-bold text-ink-muted"
            onClick={() => {
              setShowDropped(!showDropped);
            }}
          >
            {t("settle.droppedToggle", { count: dropped.length })}
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform motion-reduce:transition-none ${showDropped ? "rotate-180" : ""}`}
            />
          </button>
          {showDropped && (
            <>
              <ul aria-label={t("settle.droppedTitle")} className="collapse-enter flex flex-col">
                {byDay(dropped.slice(0, droppedVisible), true)}
              </ul>
              {dropped.length > droppedVisible && (
                <button
                  type="button"
                  className={`${secondaryButton} py-3`}
                  onClick={() => {
                    setDroppedVisible(droppedVisible + HISTORY_STEP);
                  }}
                >
                  {t("settle.historyMore")}
                </button>
              )}
            </>
          )}
        </>
      )}
      {more}
    </section>
  );
}

function involvesMe(group: Group, p: PlannedPayment): boolean {
  return p.fromMemberId === group.me.memberId || p.toMemberId === group.me.memberId;
}

function statusLabel(s: Settlement): MessageId {
  if (s.status === "undone") return "settle.status.undone";
  if (s.status === "cancelled") return "settle.status.cancelled";
  return "settle.status.confirmed";
}

/** A payment card; faded once withdrawn or undone. */
function paymentCard(faded = false): string {
  return `${card} flex flex-col gap-3 p-4 ${faded ? "opacity-70" : ""}`;
}

const STATUS_TONE: Partial<Record<MessageId, string>> = {
  "settle.status.pending": "bg-amber-100 text-amber-800",
  "settle.status.confirmed": "bg-sprout-100 text-sprout-700",
};

function Person({ id, name, isMe }: { id: string; name: string; isMe: boolean }) {
  const pictureOf = useContext(PictureContext);
  return (
    <AvatarTip name={name} pictureUrl={pictureOf(id)} isMe={isMe} className="size-10 text-base" />
  );
}

/** Connected arrow track between payer and receiver avatars. */
function TransferTrack({ tone }: { tone: "pay" | "get" | "neutral" }) {
  const badge =
    tone === "pay"
      ? "border-red-300 bg-red-50 text-red-700"
      : tone === "get"
        ? "border-sprout-200 bg-sprout-100 text-sprout-600"
        : "border-sprout-200 bg-sprout-50 text-ink-muted";
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      <span className="h-0.5 w-2 bg-sprout-200" />
      <span className={`flex size-6 items-center justify-center rounded-full border shadow-2xs ${badge}`}>
        <ArrowRight className="size-3.5 transfer-arrow-pulse" />
      </span>
      <span className="h-0.5 w-2 bg-sprout-200" />
    </span>
  );
}

/** Says why a card matters to me, in words: 你要付 or 你可收. */
function RoleTag({ paying }: { paying: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-0.5 text-xs font-bold text-white ${
        paying ? "bg-red-700" : "bg-sprout-600"
      }`}
    >
      {t(paying ? "settle.rolePay" : "settle.roleGet")}
    </span>
  );
}

function PaymentLine({
  payer,
  receiver,
  payerId,
  receiverId,
  myMemberId,
  amount,
  currency,
  badge,
  showRole = false,
  struck = false,
  updating = false,
}: {
  /** Real display names; the line itself says 你 for me. */
  payer: string;
  receiver: string;
  payerId: string;
  receiverId: string;
  myMemberId: string;
  amount: number;
  currency: CurrencyCode;
  badge?: MessageId;
  /** Tag the card 你要付 or 你可收 when it is mine to pay or collect. */
  showRole?: boolean;
  struck?: boolean;
  updating?: boolean | undefined;
}) {
  const label = (id: string, name: string) => (id === myMemberId ? t("settle.you") : name);
  const mine = payerId === myMemberId || receiverId === myMemberId;
  const tone = !mine ? "neutral" : payerId === myMemberId ? "pay" : "get";
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <Person id={payerId} name={payer} isMe={payerId === myMemberId} />
          <TransferTrack tone={tone} />
          <Person id={receiverId} name={receiver} isMe={receiverId === myMemberId} />
        </span>
        <span className="sr-only">
          {t("settle.pays", {
            payer: label(payerId, payer),
            receiver: label(receiverId, receiver),
          })}
        </span>
        <CountUp
          value={amount}
          format={(n) => formatAmount(n, currency)}
          goodWhen={tone === "pay" ? "down" : "up"}
          updating={updating}
          className={`shrink-0 text-lg font-bold tabular-nums ${
            struck
              ? "text-ink-muted line-through"
              : tone === "pay"
                ? "text-red-700"
                : "text-sprout-600"
          }`}
        />
      </div>
      {((showRole && mine) || badge !== undefined) && (
        <div className="flex flex-wrap items-center gap-2">
          {showRole && mine && <RoleTag paying={payerId === myMemberId} />}
          {badge !== undefined && (
            <span
              className={`rounded-full px-3 py-0.5 text-xs font-bold ${STATUS_TONE[badge] ?? "bg-ink/10 text-ink-muted"}`}
            >
              {t(badge)}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** One suggested payment with what I may do about it. */
function PlannedRow({
  group,
  payment,
  rows,
  currency,
  updating,
}: {
  group: Group;
  payment: PlannedPayment;
  rows: ReadonlyMap<string, BalanceRow>;
  currency: CurrencyCode;
  updating?: boolean | undefined;
}) {
  const record = useRecordSettlement(group.id);
  // One key per suggested payment, reused if a lost answer makes the person tap again.
  const key = useRef(crypto.randomUUID());
  const payer = rows.get(payment.fromMemberId);
  const receiver = rows.get(payment.toMemberId);
  if (payer === undefined || receiver === undefined) return null;
  const input = (amount: number) => ({
    payerMemberId: payer.memberId,
    receiverMemberId: receiver.memberId,
    amount,
  });
  const saved = () => {
    key.current = crypto.randomUUID();
  };
  const iPay = group.me.memberId === payer.memberId;
  const iReceive = group.me.memberId === receiver.memberId;
  const tone = iPay ? "pay" : iReceive ? "receive" : "behalf";
  const triggerLabel = iPay
    ? "settle.markPaid"
    : iReceive
      ? "settle.markReceived"
      : "settle.markBehalf";

  return (
    <>
      <PaymentLine
        payer={localName(payer.displayName)}
        receiver={localName(receiver.displayName)}
        showRole
        payerId={payer.memberId}
        receiverId={receiver.memberId}
        myMemberId={group.me.memberId}
        amount={payment.amountMinor}
        currency={currency}
        updating={updating}
      />
      {canConfirm(group.me, payer, receiver) && (
        <ConfirmSettlementDialog
          trigger={t(triggerLabel)}
          tone={tone}
          currency={currency}
          target={{
            payerName: localName(payer.displayName),
            receiverName: localName(receiver.displayName),
            suggested: payment.amountMinor,
            max: maxPayable(payer, receiver),
          }}
          submit={(amount) =>
            record.mutateAsync({ input: input(amount), idempotencyKey: key.current }).then(saved)
          }
        />
      )}
    </>
  );
}
