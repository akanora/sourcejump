"use client";
// Changes a profile's details in a dialog: the country shown by the name, and the player's setup. Staff who
// change someone else's give a reason, which goes in the staff log. The API checks every field again.
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { api, failureMessage, type Schemas } from "@/api/client";
import { Button } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";
import { detailFields } from "./detailFields";

type Aspect = Schemas["Aspect"];
const ASPECTS: Aspect[] = ["4:3", "5:4", "16:10", "16:9", "21:9", "32:9"];
/** As the API allows; the inputs stop longer text before it's sent. */
const MAX_TEXT = 48;

type Form = Record<(typeof detailFields)[number]["key"], string> & {
  country: string;
};

export function EditDetails({
  player,
  countries,
  staff,
  hasDetails,
}: {
  player: Schemas["PlayerProfile"];
  /** The countries the API accepts, named and in the order to list them. */
  countries: { code: string; name: string }[];
  /** Changing someone else's, as staff. */
  staff: boolean;
  hasDetails: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => initial(player));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setForm(initial(player));
    setError(null);
    setOpen(true);
  }

  const set = (key: keyof Form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const text = (value: string) => value.trim() || null;
  const number = (value: string) =>
    value.trim() === "" ? null : Number(value.replace(",", "."));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api
      .PUT("/v1/players/{player}/details", {
        params: { path: { player: player.steamid64 } },
        body: {
          mouse: text(form.mouse),
          dpi: number(form.dpi),
          sensitivity: number(form.sensitivity),
          mouse_pad: text(form.mouse_pad),
          keyboard: text(form.keyboard),
          monitor: text(form.monitor),
          aspect: (form.aspect || null) as Aspect | null,
          country_code: form.country || null,
          reason: staff ? reason : null,
        },
      })
      .catch(() => undefined);
    setBusy(false);
    if (!result?.response.ok) {
      setError(
        failureMessage(
          result?.error,
          "Your details couldn't be saved. Try again.",
        ),
      );
      return;
    }
    setOpen(false);
    setReason("");
    router.refresh();
  }

  const textField = (
    key: "mouse" | "mouse_pad" | "keyboard" | "monitor",
    placeholder: string,
  ) => (
    <Field label={label(key)}>
      <Input
        value={form[key]}
        onChange={(event) => set(key)(event.target.value)}
        maxLength={MAX_TEXT}
        placeholder={placeholder}
        autoComplete="off"
      />
    </Field>
  );

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <Pencil aria-hidden />
        {hasDetails || staff ? "Edit details" : "Add details"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={staff ? `${player.name}'s details` : "Your details"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={save}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Field label="Country" wide>
            <Select
              value={form.country}
              onChange={(event) => set("country")(event.target.value)}
            >
              <option value="">From Steam</option>
              {countries.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          {textField("mouse", "Your mouse")}
          {textField("mouse_pad", "Your mouse pad")}
          <Field label={label("dpi")}>
            <Input
              type="number"
              inputMode="numeric"
              min={50}
              max={64000}
              step={1}
              value={form.dpi}
              onChange={(event) => set("dpi")(event.target.value)}
              placeholder="800"
            />
          </Field>
          <Field label={label("sensitivity")}>
            <Input
              type="number"
              inputMode="decimal"
              min={0.0001}
              max={100}
              step="any"
              value={form.sensitivity}
              onChange={(event) => set("sensitivity")(event.target.value)}
              placeholder="In-game, e.g. 1.5"
            />
          </Field>
          {textField("keyboard", "Your keyboard")}
          {textField("monitor", "Your monitor")}
          <Field label={label("aspect")}>
            <Select
              value={form.aspect}
              onChange={(event) => set("aspect")(event.target.value)}
            >
              <option value="">Not set</option>
              {ASPECTS.map((aspect) => (
                <option key={aspect} value={aspect}>
                  {aspect}
                </option>
              ))}
            </Select>
          </Field>
          {staff && (
            <Field label="Reason, for staff only" wide>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                required
              />
            </Field>
          )}
          {error && (
            <p className="text-danger text-sm sm:col-span-2">{error}</p>
          )}
        </form>
      </Dialog>
    </>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string;
  /** Spans both columns. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={classNames(
        "flex flex-col gap-1.5 text-sm",
        wide && "sm:col-span-2",
      )}
    >
      {label}
      {children}
    </label>
  );
}

function label(key: (typeof detailFields)[number]["key"]): string {
  return detailFields.find((field) => field.key === key)?.label ?? key;
}

/** The form as the profile shows it now. Old-site details start the form, so saving keeps them. */
function initial(player: Schemas["PlayerProfile"]): Form {
  const d = player.details;
  const text = (value: string | number | null | undefined) =>
    value == null ? "" : String(value);
  return {
    country: player.country_chosen ? (player.country_code ?? "") : "",
    mouse: text(d?.mouse),
    dpi: text(d?.dpi),
    sensitivity: text(d?.sensitivity),
    mouse_pad: text(d?.mouse_pad),
    keyboard: text(d?.keyboard),
    monitor: text(d?.monitor),
    aspect: text(d?.aspect),
  };
}
