import type { LucideIcon } from 'lucide-react';
import { Box, Building2, CreditCard, Gift, IdCard, Coins, SlidersHorizontal, UserRound } from 'lucide-react';

export type SettingsSectionId =
  | 'profile'
  | 'personalData'
  | 'office'
  | 'billing'
  | 'credits'
  | 'referrals'
  | 'preferences'
  | 'sketchup';

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  /** Relative path under /configuracoes (e.g. "perfil" -> /configuracoes/perfil). */
  path: string;
  icon: LucideIcon;
  /** Visually marked "coming soon" in the nav — still fully navigable, never a dead click. */
  locked?: boolean;
}

/** Single source of truth for the settings area's internal navigation. */
export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  { id: 'profile', path: 'perfil', icon: UserRound },
  { id: 'personalData', path: 'dados-pessoais', icon: IdCard },
  { id: 'office', path: 'escritorio', icon: Building2 },
  { id: 'billing', path: 'plano', icon: CreditCard },
  { id: 'credits', path: 'creditos', icon: Coins },
  { id: 'referrals', path: 'indicacoes', icon: Gift },
  { id: 'preferences', path: 'preferencias', icon: SlidersHorizontal },
  { id: 'sketchup', path: 'sketchup', icon: Box, locked: true },
];
