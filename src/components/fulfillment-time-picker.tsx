"use client";

import { useId } from "react";
import {
  findFulfillmentTimeSlot,
  uniqueFulfillmentTimeValues,
  type FulfillmentTimeSlot,
} from "@/lib/fulfillment-time-options";

type Props = {
  slots: FulfillmentTimeSlot[];
  value: string;
  onChange: (value: string) => void;
  legend: string;
  scheduledLabel: string;
  dateLabel: string;
  timeLabel: string;
  unavailableDateMessage: string;
  allowAsap?: boolean;
  asapLabel?: string;
  required?: boolean;
  disabled?: boolean;
  testId?: string;
  className?: string;
};

export function FulfillmentTimePicker({
  slots,
  value,
  onChange,
  legend,
  scheduledLabel,
  dateLabel,
  timeLabel,
  unavailableDateMessage,
  allowAsap = true,
  asapLabel = "儘快，不指定時間",
  required = false,
  disabled = false,
  testId,
  className = "",
}: Props) {
  const radioName = useId();
  const dateListId = useId();
  const selected = slots.find((slot) => slot.iso === value) ?? slots[0] ?? null;
  if (!selected) return null;

  const dates = uniqueFulfillmentTimeValues(slots, "date");
  const hours = uniqueFulfillmentTimeValues(
    slots.filter((slot) => slot.date === selected.date),
    "hour",
  );
  const minutes = uniqueFulfillmentTimeValues(
    slots.filter((slot) => slot.date === selected.date && slot.hour === selected.hour),
    "minute",
  );
  const scheduled = !allowAsap || value !== "";

  function selectFirstMatching(filter: Parameters<typeof findFulfillmentTimeSlot>[1]) {
    const next = findFulfillmentTimeSlot(slots, filter);
    if (next) onChange(next.iso);
    return next;
  }

  return (
    <fieldset className={`min-w-0 rounded-md border border-stone-200 p-3 ${className}`}>
      <legend className="px-1 text-xs font-semibold text-stone-600">{legend}</legend>
      {allowAsap ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-medium">
            <input
              type="radio"
              name={radioName}
              checked={!scheduled}
              required={required}
              disabled={disabled}
              onChange={() => onChange("")}
            />
            {asapLabel}
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-medium">
            <input
              type="radio"
              name={radioName}
              checked={scheduled}
              required={required}
              disabled={disabled}
              onChange={() => onChange(selected.iso)}
            />
            {scheduledLabel}
          </label>
        </div>
      ) : null}

      {scheduled ? (
        <div data-testid={testId} className={`${allowAsap ? "mt-3" : ""} grid min-w-0 gap-3`}>
          <label className="block min-w-0 text-xs font-semibold text-stone-600">
            {dateLabel}
            <input
              type="date"
              list={dateListId}
              min={dates[0]}
              max={dates.at(-1)}
              value={selected.date}
              required={required}
              disabled={disabled}
              onChange={(event) => {
                const next = selectFirstMatching({ date: event.target.value });
                event.target.setCustomValidity(next ? "" : unavailableDateMessage);
                if (!next) event.target.reportValidity();
              }}
              className="mt-1 h-12 min-w-0 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
            />
            <datalist id={dateListId}>
              {dates.map((date) => <option key={date} value={date} />)}
            </datalist>
          </label>

          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-600">{timeLabel}</p>
            <div className="mt-1 grid min-w-0 grid-cols-2 gap-2">
              <label className="min-w-0 text-xs font-medium text-stone-600">
                時（24 小時制）
                <select
                  aria-label={`${timeLabel}－時`}
                  value={selected.hour}
                  required={required}
                  disabled={disabled}
                  onChange={(event) => selectFirstMatching({
                    date: selected.date,
                    hour: event.target.value,
                  })}
                  className="mt-1 h-12 min-w-0 w-full rounded-md border border-stone-300 bg-white px-2 text-sm"
                >
                  {hours.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                </select>
              </label>
              <label className="min-w-0 text-xs font-medium text-stone-600">
                分（每 5 分鐘）
                <select
                  aria-label={`${timeLabel}－分`}
                  value={selected.minute}
                  required={required}
                  disabled={disabled}
                  onChange={(event) => selectFirstMatching({
                    date: selected.date,
                    hour: selected.hour,
                    minute: event.target.value,
                  })}
                  className="mt-1 h-12 min-w-0 w-full rounded-md border border-stone-300 bg-white px-2 text-sm"
                >
                  {minutes.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
                </select>
              </label>
            </div>
          </div>
          <p className="text-xs text-stone-500">只會顯示店家目前可接受的日期與時段。</p>
        </div>
      ) : null}
    </fieldset>
  );
}
