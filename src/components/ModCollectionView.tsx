import type { GameRecord, ModLoadState, ModRecord, ViewMode } from '@shared/types';
import { ModCard } from './ModCard';
import { ModCarousel } from './ModCarousel';
import { ModTable } from './ModTable';

type Props = {
  /** Enabled/position in the game's own mod list (RimWorld, PZ, Isaac). */
  loadStates?: Map<string, ModLoadState>;
  onToggleEnabled?: (mod: ModRecord, enabled: boolean) => void;
  onReorder?: (draggedModId: string, targetModId: string) => void;
  orderSortActive?: boolean;
  onOrderSort?: (active: boolean) => void;
  mods: ModRecord[];
  games: GameRecord[];
  viewMode: ViewMode;
  cardVariant?: 'steam' | 'nexus' | 'library';
  trackedNexus?: Set<string>;
  onTrackedNexusChange?: () => void;
  onFavorite: (mod: ModRecord) => void;
  onDismiss?: (mod: ModRecord) => void;
  onSubscribe?: (mod: ModRecord) => void;
  onDeleteLocal?: (mod: ModRecord) => void;
  emptyMessage?: string;
};

export function ModCollectionView({
  onReorder,
  orderSortActive,
  onOrderSort,
  loadStates,
  onToggleEnabled,
  mods,
  games,
  viewMode,
  cardVariant,
  trackedNexus,
  onTrackedNexusChange,
  onFavorite,
  onDismiss,
  onSubscribe,
  onDeleteLocal,
  emptyMessage,
}: Props) {
  if (mods.length === 0) {
    return (
      <div className="empty-state">
        {emptyMessage ?? 'No mods match. Run Scan computer or change filters.'}
      </div>
    );
  }

  if (viewMode === 'list') {
    return <ModTable mods={mods} games={games} trackedNexus={trackedNexus} loadStates={loadStates} onFavorite={onFavorite} onToggleEnabled={onToggleEnabled} onReorder={onReorder} orderSortActive={orderSortActive} onOrderSort={onOrderSort} />;
  }

  const cards = mods.map((mod) => (
    <ModCard
      key={mod.id}
      mod={mod}
      loadState={loadStates?.get(mod.id)}
      onToggleEnabled={onToggleEnabled}
      games={games}
      variant={cardVariant}
      trackedNexus={trackedNexus}
      onTrackedNexusChange={onTrackedNexusChange}
      onFavorite={onFavorite}
      onDismiss={onDismiss}
      onSubscribe={onSubscribe}
      onDeleteLocal={onDeleteLocal}
    />
  ));

  const wrapClass = viewMode === 'carousel' ? 'library-carousel-wrap' : undefined;

  if (viewMode === 'carousel') {
    return (
      <div className={wrapClass}>
        <ModCarousel itemCount={mods.length}>{cards}</ModCarousel>
      </div>
    );
  }

  const className = viewMode === 'grid' ? 'mod-grid' : 'mod-list';
  return <div className={className}>{cards}</div>;
}
