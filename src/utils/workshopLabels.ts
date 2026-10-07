/** Steam Workshop localization stubs / placeholder titles. */
export function isWorkshopStubTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^#/.test(t)) return true;
  if (/ControllerSaveDefaultTitle|Library_/i.test(t)) return true;
  if (/^Workshop\s+\d{8,}$/i.test(t)) return true;
  return false;
}

export function workshopDisplayTitle(mod: { title: string; workshopId?: string }): string {
  if (!isWorkshopStubTitle(mod.title)) return mod.title;
  if (mod.workshopId) return `Workshop item ${mod.workshopId}`;
  return mod.title.replace(/^#+/, '').trim() || 'Local Workshop item';
}
