import type { GameRecord, IsaacConflicts, ModLoadState, ModRecord, SecurityStatus, ViewMode } from '@shared/types';
import { ModCollectionView } from '../components/ModCollectionView';

type Props = {
  loadStates?: Map<string, ModLoadState>;
  onToggleEnabled?: (mod: ModRecord, enabled: boolean) => void;
  onReorder?: (draggedModId: string, targetModId: string) => void;
  orderSortActive?: boolean;
  /** Isaac file conflicts per catalog mod id. */
  conflicts?: IsaacConflicts['perMod'];
  /** Malware-check overview per mod id. */
  security?: Record<string, { status: SecurityStatus; executables: number; stale: boolean; checkedAt?: string; lua?: string[] }>;
  onOrderSort?: (active: boolean) => void;
  mods: ModRecord[];
  games: GameRecord[];
  viewMode: ViewMode;
  trackedNexus?: Set<string>;
  onTrackedNexusChange?: () => void;
  onFavorite: (mod: ModRecord) => void;
  onDismiss?: (mod: ModRecord) => void;
  onSubscribe: (mod: ModRecord) => void;
  onDeleteLocal?: (mod: ModRecord) => void;
};

export function LibraryView({
  onReorder,
  orderSortActive,
  conflicts,
  security,
  onOrderSort,
  loadStates,
  onToggleEnabled,
  mods,
  games,
  viewMode,
  trackedNexus,
  onTrackedNexusChange,
  onFavorite,
  onDismiss,
  onSubscribe,
  onDeleteLocal,
}: Props) {
  return (
    <ModCollectionView
      loadStates={loadStates}
      onReorder={onReorder}
      orderSortActive={orderSortActive}
      conflicts={conflicts}
      security={security}
      onOrderSort={onOrderSort}
      onToggleEnabled={onToggleEnabled}
      mods={mods}
      games={games}
      viewMode={viewMode}
      cardVariant="library"
      trackedNexus={trackedNexus}
      onTrackedNexusChange={onTrackedNexusChange}
      onFavorite={onFavorite}
      onDismiss={onDismiss}
      onSubscribe={onSubscribe}
      onDeleteLocal={onDeleteLocal}
    />
  );
}
