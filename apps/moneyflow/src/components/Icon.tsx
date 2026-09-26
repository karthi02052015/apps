import {
  Award, Banknote, BookOpen, Briefcase, CalendarCheck, CircleEllipsis, CirclePlus,
  Clapperboard, Coins, CreditCard, Droplets, Fuel, Gift, GraduationCap, HandCoins,
  HandHeart, Handshake, HeartPulse, Home, KeyRound, Lamp, Landmark, Laptop,
  LineChart, Package, PalmtreeIcon, Percent, PieChart, PiggyBank, Plane, Receipt,
  Repeat, ShieldCheck, Shield, ShoppingBag, ShoppingBasket, Smartphone, Sparkles,
  Store, Tag, Target, TrendingDown, TrendingUp, Undo2, Utensils, Wallet, Wifi, Zap,
  AlertTriangle, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { swatch } from '@/lib/tokens';

/**
 * Icons are referenced by name (a string from the database), so the set has to
 * be enumerated explicitly — a dynamic `lucide-react/${name}` import would
 * defeat tree-shaking and pull the entire icon library into the bundle.
 */
const REGISTRY: Record<string, LucideIcon> = {
  award: Award, banknote: Banknote, book: BookOpen, briefcase: Briefcase,
  'calendar-check': CalendarCheck, 'circle-ellipsis': CircleEllipsis,
  'circle-plus': CirclePlus, clapperboard: Clapperboard, coins: Coins,
  'credit-card': CreditCard, droplets: Droplets, fuel: Fuel, gift: Gift,
  'graduation-cap': GraduationCap, 'hand-coins': HandCoins, 'hand-heart': HandHeart,
  handshake: Handshake, 'heart-pulse': HeartPulse, home: Home, 'key-round': KeyRound,
  lamp: Lamp, landmark: Landmark, laptop: Laptop, 'line-chart': LineChart,
  package: Package, palmtree: PalmtreeIcon, percent: Percent, 'pie-chart': PieChart,
  'piggy-bank': PiggyBank, plane: Plane, receipt: Receipt, repeat: Repeat,
  shield: Shield, 'shield-check': ShieldCheck, 'shopping-bag': ShoppingBag,
  'shopping-basket': ShoppingBasket, smartphone: Smartphone, sparkles: Sparkles,
  store: Store, tag: Tag, target: Target, 'trending-down': TrendingDown,
  'trending-up': TrendingUp, 'undo-2': Undo2, utensils: Utensils, wallet: Wallet,
  wifi: Wifi, zap: Zap, 'alert-triangle': AlertTriangle,
};

export function iconFor(name: string | null | undefined): LucideIcon {
  return REGISTRY[name ?? ''] ?? Tag;
}

/** A rounded, tinted tile holding a category or account icon. */
export function IconTile({
  icon, color, size = 'md', className,
}: {
  icon: string | null | undefined;
  color: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const Glyph = iconFor(icon);
  const dimensions =
    size === 'sm' ? 'h-8 w-8 rounded-lg' : size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-10 w-10 rounded-xl';
  const glyphSize = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', dimensions, swatch(color).chip, className)}
      aria-hidden
    >
      <Glyph className={glyphSize} />
    </span>
  );
}
