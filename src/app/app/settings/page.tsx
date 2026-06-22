import { getSettings } from "@/lib/settings";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { SettingsForm } from "./SettingsForm";
import { PinGate } from "@/components/PinGate";

export default async function SettingsPage() {
  const unlocked = await isSettingsUnlocked();
  if (!unlocked) return <PinGate title="Settings locked" subtitle="Enter the PIN to manage company details and rates." />;

  const settings = await getSettings();
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted">Company details and per-km conveyance rates.</p>
      </div>
      <SettingsForm settings={settings} />
    </div>
  );
}
