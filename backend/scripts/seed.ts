/**
 * Seeds a realistic demo dataset: a mid-sized FMCG distributor with 4 warehouses,
 * 8 suppliers, 40 products and 12 months of daily sales history with weekly,
 * seasonal (summer, festive season) and trend effects.
 *
 *   npm run db:seed
 *
 * WARNING: wipes all existing data. Deterministic (fixed random seed), so every
 * run produces the same demo.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import {
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockLevels,
  stockMovements,
  suppliers,
  users,
  warehouses,
} from '../src/db/schema';
import { ean13CheckDigit } from '../src/utils/barcode';

// ---------- deterministic randomness ----------
let seed = 20261107;
function rand() {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => a + rand() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
/** Poisson-distributed integer (Knuth for small means, normal approximation for large). */
function poisson(mean: number) {
  if (mean <= 0) return 0;
  if (mean > 40) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian()));
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}
function gaussian() {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- master data ----------
const WAREHOUSES = [
  {
    code: 'KOL',
    name: 'Kolkata Hub',
    city: 'Howrah, West Bengal',
    address: 'NH-16, Dhulagarh Industrial Park',
    demand: 1.0,
  },
  {
    code: 'MUM',
    name: 'Mumbai DC',
    city: 'Bhiwandi, Maharashtra',
    address: 'Plot 22, Vadpe Logistics Park',
    demand: 1.35,
  },
  { code: 'DEL', name: 'Delhi NCR DC', city: 'Gurugram, Haryana', address: 'Sector 37, Pace City II', demand: 1.2 },
  { code: 'BLR', name: 'Bengaluru DC', city: 'Hoskote, Karnataka', address: 'KIADB Industrial Area', demand: 0.85 },
];

const SUPPLIERS = [
  { key: 'grain', name: 'Annapurna Agro Foods', contactName: 'Suresh Agarwal', city: 'Kolkata', leadTimeDays: 5 },
  { key: 'bev', name: 'Himalaya Beverages Pvt Ltd', contactName: 'Kavita Rao', city: 'Pune', leadTimeDays: 7 },
  { key: 'care', name: 'Lotus Personal Care', contactName: 'Imran Shaikh', city: 'Mumbai', leadTimeDays: 10 },
  { key: 'home', name: 'Sparkle Home Products', contactName: 'Deepa Nair', city: 'Chennai', leadTimeDays: 12 },
  { key: 'snack', name: 'Crunchy Bites Foods', contactName: 'Harpreet Singh', city: 'Ludhiana', leadTimeDays: 6 },
  { key: 'dairy', name: 'GreenValley Dairy Co-op', contactName: 'Mahesh Patel', city: 'Anand', leadTimeDays: 3 },
  { key: 'spice', name: 'Malabar Spice Traders', contactName: 'Thomas Mathew', city: 'Kochi', leadTimeDays: 14 },
  { key: 'pack', name: 'Urban Pantry Packaged Foods', contactName: 'Ritu Malhotra', city: 'Noida', leadTimeDays: 8 },
];

type Profile = 'steady' | 'summer' | 'festive' | 'slow' | 'growing' | 'declining';
interface P {
  sku: string;
  name: string;
  category: string;
  unit: string;
  cost: number;
  sell: number;
  supplier: string;
  demand: number; // average units/day for a demand-1.0 warehouse
  profile: Profile;
  /** Current stock situation to create interesting demo states. */
  state?: 'critical' | 'low' | 'excess' | 'out';
}

const PRODUCTS: P[] = [
  // Staples
  {
    sku: 'STP-RICE-5',
    name: 'Premium Basmati Rice 5 kg',
    category: 'Staples',
    unit: 'bag',
    cost: 520,
    sell: 649,
    supplier: 'grain',
    demand: 34,
    profile: 'festive',
    state: 'low',
  },
  {
    sku: 'STP-ATTA-10',
    name: 'Whole Wheat Atta 10 kg',
    category: 'Staples',
    unit: 'bag',
    cost: 365,
    sell: 440,
    supplier: 'grain',
    demand: 48,
    profile: 'steady',
    state: 'critical',
  },
  {
    sku: 'STP-DAL-1',
    name: 'Toor Dal 1 kg',
    category: 'Staples',
    unit: 'pack',
    cost: 128,
    sell: 165,
    supplier: 'grain',
    demand: 55,
    profile: 'steady',
  },
  {
    sku: 'STP-SUGAR-5',
    name: 'Refined Sugar 5 kg',
    category: 'Staples',
    unit: 'bag',
    cost: 205,
    sell: 245,
    supplier: 'grain',
    demand: 30,
    profile: 'festive',
  },
  {
    sku: 'STP-OIL-1',
    name: 'Sunflower Oil 1 L',
    category: 'Staples',
    unit: 'bottle',
    cost: 128,
    sell: 155,
    supplier: 'grain',
    demand: 62,
    profile: 'steady',
    state: 'low',
  },
  {
    sku: 'STP-POHA-1',
    name: 'Thick Poha 1 kg',
    category: 'Staples',
    unit: 'pack',
    cost: 48,
    sell: 65,
    supplier: 'grain',
    demand: 14,
    profile: 'slow',
    state: 'excess',
  },
  // Beverages
  {
    sku: 'BEV-TEA-500',
    name: 'Assam CTC Tea 500 g',
    category: 'Beverages',
    unit: 'pack',
    cost: 215,
    sell: 275,
    supplier: 'bev',
    demand: 40,
    profile: 'steady',
  },
  {
    sku: 'BEV-COF-200',
    name: 'Instant Coffee 200 g',
    category: 'Beverages',
    unit: 'jar',
    cost: 395,
    sell: 499,
    supplier: 'bev',
    demand: 12,
    profile: 'growing',
  },
  {
    sku: 'BEV-MANGO-1',
    name: 'Mango Drink 1.2 L',
    category: 'Beverages',
    unit: 'bottle',
    cost: 58,
    sell: 80,
    supplier: 'bev',
    demand: 38,
    profile: 'summer',
  },
  {
    sku: 'BEV-LEMON-750',
    name: 'Lemon Soda 750 ml',
    category: 'Beverages',
    unit: 'bottle',
    cost: 24,
    sell: 40,
    supplier: 'bev',
    demand: 45,
    profile: 'summer',
    state: 'excess',
  },
  {
    sku: 'BEV-WATER-1',
    name: 'Packaged Drinking Water 1 L',
    category: 'Beverages',
    unit: 'bottle',
    cost: 11,
    sell: 20,
    supplier: 'bev',
    demand: 140,
    profile: 'summer',
  },
  {
    sku: 'BEV-HEALTH-500',
    name: 'Malt Health Drink 500 g',
    category: 'Beverages',
    unit: 'jar',
    cost: 215,
    sell: 265,
    supplier: 'bev',
    demand: 16,
    profile: 'steady',
    state: 'out',
  },
  // Personal care
  {
    sku: 'PC-SHAMPOO-340',
    name: 'Herbal Shampoo 340 ml',
    category: 'Personal Care',
    unit: 'bottle',
    cost: 185,
    sell: 245,
    supplier: 'care',
    demand: 22,
    profile: 'steady',
  },
  {
    sku: 'PC-SOAP-4',
    name: 'Sandal Soap (Pack of 4)',
    category: 'Personal Care',
    unit: 'pack',
    cost: 120,
    sell: 160,
    supplier: 'care',
    demand: 36,
    profile: 'steady',
    state: 'low',
  },
  {
    sku: 'PC-PASTE-150',
    name: 'Clove Toothpaste 150 g',
    category: 'Personal Care',
    unit: 'tube',
    cost: 78,
    sell: 105,
    supplier: 'care',
    demand: 42,
    profile: 'steady',
  },
  {
    sku: 'PC-SUNSCR-100',
    name: 'Sunscreen SPF 50, 100 ml',
    category: 'Personal Care',
    unit: 'tube',
    cost: 210,
    sell: 299,
    supplier: 'care',
    demand: 8,
    profile: 'summer',
    state: 'excess',
  },
  {
    sku: 'PC-HANDW-750',
    name: 'Hand Wash Refill 750 ml',
    category: 'Personal Care',
    unit: 'pouch',
    cost: 82,
    sell: 115,
    supplier: 'care',
    demand: 20,
    profile: 'growing',
  },
  {
    sku: 'PC-HAIROIL-300',
    name: 'Coconut Hair Oil 300 ml',
    category: 'Personal Care',
    unit: 'bottle',
    cost: 118,
    sell: 150,
    supplier: 'care',
    demand: 26,
    profile: 'steady',
  },
  // Household
  {
    sku: 'HH-DETPWD-2',
    name: 'Detergent Powder 2 kg',
    category: 'Household',
    unit: 'pack',
    cost: 190,
    sell: 240,
    supplier: 'home',
    demand: 32,
    profile: 'festive',
    state: 'critical',
  },
  {
    sku: 'HH-DISH-500',
    name: 'Dishwash Gel 500 ml',
    category: 'Household',
    unit: 'bottle',
    cost: 92,
    sell: 125,
    supplier: 'home',
    demand: 28,
    profile: 'steady',
  },
  {
    sku: 'HH-FLOOR-1',
    name: 'Floor Cleaner 1 L',
    category: 'Household',
    unit: 'bottle',
    cost: 145,
    sell: 189,
    supplier: 'home',
    demand: 18,
    profile: 'festive',
  },
  {
    sku: 'HH-TOILET-500',
    name: 'Toilet Cleaner 500 ml',
    category: 'Household',
    unit: 'bottle',
    cost: 78,
    sell: 99,
    supplier: 'home',
    demand: 22,
    profile: 'steady',
  },
  {
    sku: 'HH-MOSQ-45',
    name: 'Mosquito Repellent Refill',
    category: 'Household',
    unit: 'pcs',
    cost: 62,
    sell: 85,
    supplier: 'home',
    demand: 24,
    profile: 'summer',
  },
  {
    sku: 'HH-AGARB-100',
    name: 'Incense Sticks (100 pcs)',
    category: 'Household',
    unit: 'box',
    cost: 38,
    sell: 60,
    supplier: 'home',
    demand: 15,
    profile: 'festive',
    state: 'low',
  },
  // Snacks
  {
    sku: 'SN-CHIPS-90',
    name: 'Salted Potato Chips 90 g',
    category: 'Snacks',
    unit: 'pack',
    cost: 28,
    sell: 40,
    supplier: 'snack',
    demand: 95,
    profile: 'festive',
  },
  {
    sku: 'SN-BHUJIA-400',
    name: 'Aloo Bhujia 400 g',
    category: 'Snacks',
    unit: 'pack',
    cost: 82,
    sell: 110,
    supplier: 'snack',
    demand: 30,
    profile: 'festive',
    state: 'critical',
  },
  {
    sku: 'SN-BISC-600',
    name: 'Glucose Biscuits Family Pack',
    category: 'Snacks',
    unit: 'pack',
    cost: 52,
    sell: 70,
    supplier: 'snack',
    demand: 70,
    profile: 'steady',
  },
  {
    sku: 'SN-COOKIE-250',
    name: 'Butter Cookies 250 g',
    category: 'Snacks',
    unit: 'pack',
    cost: 72,
    sell: 99,
    supplier: 'snack',
    demand: 26,
    profile: 'festive',
  },
  {
    sku: 'SN-NAMKEEN-1',
    name: 'Mixture Namkeen 1 kg',
    category: 'Snacks',
    unit: 'pack',
    cost: 165,
    sell: 220,
    supplier: 'snack',
    demand: 10,
    profile: 'slow',
    state: 'excess',
  },
  {
    sku: 'SN-MAKHANA-100',
    name: 'Roasted Makhana 100 g',
    category: 'Snacks',
    unit: 'pack',
    cost: 88,
    sell: 130,
    supplier: 'snack',
    demand: 14,
    profile: 'growing',
  },
  // Dairy
  {
    sku: 'DY-GHEE-1',
    name: 'Cow Ghee 1 L',
    category: 'Dairy',
    unit: 'tin',
    cost: 560,
    sell: 690,
    supplier: 'dairy',
    demand: 18,
    profile: 'festive',
    state: 'low',
  },
  {
    sku: 'DY-PANEER-200',
    name: 'Fresh Paneer 200 g',
    category: 'Dairy',
    unit: 'pack',
    cost: 72,
    sell: 95,
    supplier: 'dairy',
    demand: 40,
    profile: 'steady',
  },
  {
    sku: 'DY-BUTTER-500',
    name: 'Salted Butter 500 g',
    category: 'Dairy',
    unit: 'pack',
    cost: 245,
    sell: 285,
    supplier: 'dairy',
    demand: 20,
    profile: 'steady',
  },
  {
    sku: 'DY-MILKPWD-1',
    name: 'Dairy Whitener 1 kg',
    category: 'Dairy',
    unit: 'pack',
    cost: 385,
    sell: 460,
    supplier: 'dairy',
    demand: 9,
    profile: 'declining',
  },
  // Spices
  {
    sku: 'SP-TURMERIC-200',
    name: 'Turmeric Powder 200 g',
    category: 'Spices',
    unit: 'pack',
    cost: 48,
    sell: 68,
    supplier: 'spice',
    demand: 28,
    profile: 'steady',
  },
  {
    sku: 'SP-CHILLI-200',
    name: 'Red Chilli Powder 200 g',
    category: 'Spices',
    unit: 'pack',
    cost: 62,
    sell: 88,
    supplier: 'spice',
    demand: 26,
    profile: 'steady',
    state: 'low',
  },
  {
    sku: 'SP-GARAM-100',
    name: 'Garam Masala 100 g',
    category: 'Spices',
    unit: 'pack',
    cost: 68,
    sell: 95,
    supplier: 'spice',
    demand: 18,
    profile: 'festive',
  },
  // Packaged foods
  {
    sku: 'PF-NOODLE-12',
    name: 'Instant Noodles (Pack of 12)',
    category: 'Packaged Foods',
    unit: 'pack',
    cost: 135,
    sell: 168,
    supplier: 'pack',
    demand: 44,
    profile: 'growing',
  },
  {
    sku: 'PF-OATS-1',
    name: 'Rolled Oats 1 kg',
    category: 'Packaged Foods',
    unit: 'pack',
    cost: 155,
    sell: 199,
    supplier: 'pack',
    demand: 12,
    profile: 'growing',
  },
  {
    sku: 'PF-KETCHUP-1',
    name: 'Tomato Ketchup 1 kg',
    category: 'Packaged Foods',
    unit: 'bottle',
    cost: 112,
    sell: 145,
    supplier: 'pack',
    demand: 20,
    profile: 'steady',
    state: 'excess',
  },
];

const USERS = [
  { name: 'Aarav Mehta', email: 'admin@stocksense.in', role: 'ADMIN' as const },
  { name: 'Neha Kapoor', email: 'manager@stocksense.in', role: 'MANAGER' as const },
  { name: 'Rohan Das', email: 'purchaser@stocksense.in', role: 'PURCHASER' as const },
  { name: 'Ishita Roy', email: 'viewer@stocksense.in', role: 'VIEWER' as const },
];
export const DEMO_PASSWORD = 'Demo@1234';

// ---------- demand model ----------
const DAY = 86_400_000;

function seasonal(profile: Profile, d: Date, daysAgo: number) {
  const m = d.getUTCMonth(); // 0 = Jan
  const dow = d.getUTCDay(); // 0 = Sun
  let f = dow === 0 || dow === 6 ? 1.22 : dow === 1 ? 0.88 : 1; // weekend peak, Monday dip
  if (profile === 'summer') f *= [0.7, 0.75, 1.0, 1.45, 1.7, 1.55, 1.05, 0.95, 0.9, 0.85, 0.75, 0.7][m];
  if (profile === 'festive') f *= [1, 0.95, 1.0, 0.95, 0.95, 0.95, 1, 1.05, 1.15, 1.45, 1.35, 1.05][m];
  if (profile === 'growing') f *= 1 + ((365 - daysAgo) / 365) * 0.55; // +55% over the year
  if (profile === 'declining') f *= 1.35 - ((365 - daysAgo) / 365) * 0.45;
  if (profile === 'slow') f *= 0.6;
  return f;
}

function ean13(i: number) {
  const body = `8901234${String(10000 + i).padStart(5, '0')}`;
  return body + ean13CheckDigit(body);
}

async function main() {
  console.log('⏳ Seeding StockSense demo data…');
  await db.execute(sql`truncate table alerts, forecasts, purchase_order_items, purchase_orders, stock_movements,
    stock_levels, products, suppliers, warehouses, refresh_tokens, users restart identity cascade`);
  await db.execute(sql`alter sequence po_number_seq restart with 1001`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userRows = await db
    .insert(users)
    .values(USERS.map((u) => ({ ...u, passwordHash })))
    .returning();
  const manager = userRows.find((u) => u.role === 'MANAGER')!;
  const purchaser = userRows.find((u) => u.role === 'PURCHASER')!;
  const admin = userRows.find((u) => u.role === 'ADMIN')!;

  const whRows = await db
    .insert(warehouses)
    .values(WAREHOUSES.map(({ demand: _d, ...w }) => w))
    .returning();
  const whDemand = new Map(whRows.map((w) => [w.id, WAREHOUSES.find((x) => x.code === w.code)!.demand]));

  const supRows = await db
    .insert(suppliers)
    .values(
      SUPPLIERS.map(({ key, ...s }) => ({
        ...s,
        email: `orders@${key}-supplies.example.in`,
        phone: `+91 98${Math.floor(between(10000000, 99999999))}`,
      })),
    )
    .returning();
  const supByKey = new Map(SUPPLIERS.map((s, i) => [s.key, supRows[i]]));

  const prodRows = await db
    .insert(products)
    .values(
      PRODUCTS.map((p, i) => ({
        sku: p.sku,
        barcode: ean13(i),
        name: p.name,
        category: p.category,
        unit: p.unit,
        costPrice: p.cost,
        sellPrice: p.sell,
        supplierId: supByKey.get(p.supplier)!.id,
      })),
    )
    .returning();
  const meta = new Map(prodRows.map((r, i) => [r.id, PRODUCTS[i]]));
  console.log(
    `  ✓ ${userRows.length} users, ${whRows.length} warehouses, ${supRows.length} suppliers, ${prodRows.length} products`,
  );

  // ---- 12 months of daily POS sales (one aggregated SALE row per product/warehouse/day) ----
  const now = new Date();
  const todayNoon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  const todayFraction = Math.min(1, Math.max(0.35, (now.getUTCHours() + 5.5) / 24)); // share of the IST day elapsed
  type MovementRow = typeof stockMovements.$inferInsert;
  const sales: MovementRow[] = [];
  const recentDemand = new Map<string, number>(); // avg of last 28 days, used to set current stock

  for (const p of prodRows) {
    const m = meta.get(p.id)!;
    for (const w of whRows) {
      const scale = whDemand.get(w.id)! * between(0.8, 1.2);
      let last28 = 0;
      for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
        const d = new Date(todayNoon - daysAgo * DAY);
        let mean = m.demand * scale * seasonal(m.profile, d, daysAgo);
        if (daysAgo === 0) mean *= todayFraction;
        // Occasional promotion spikes.
        if (rand() < 0.015) mean *= between(1.8, 2.6);
        const qty = poisson(mean);
        if (daysAgo <= 28 && daysAgo > 0) last28 += qty;
        if (qty === 0) continue;
        sales.push({
          productId: p.id,
          warehouseId: w.id,
          type: 'SALE',
          quantity: -qty,
          reference: 'POS-DAILY',
          note: 'End-of-day POS sync',
          createdAt: daysAgo === 0 ? new Date(Math.min(now.getTime() - 60_000, todayNoon)) : d,
        });
      }
      recentDemand.set(`${p.id}:${w.id}`, last28 / 28);
    }
  }
  for (let i = 0; i < sales.length; i += 4000) await db.insert(stockMovements).values(sales.slice(i, i + 4000));
  console.log(`  ✓ ${sales.length.toLocaleString()} daily sales records (12 months)`);

  // ---- current stock levels: chosen so the demo shows healthy, low, out and overstocked items ----
  const levels: (typeof stockLevels.$inferInsert)[] = [];
  for (const p of prodRows) {
    const m = meta.get(p.id)!;
    const lead = supByKey.get(m.supplier)!.leadTimeDays;
    for (const w of whRows) {
      const daily = recentDemand.get(`${p.id}:${w.id}`)!;
      // Different warehouses get different situations so every warehouse view is interesting.
      const featured = m.state && (w.code === 'KOL' || w.code === 'MUM' || rand() < 0.35);
      let cover: number;
      if (featured && m.state === 'out') cover = w.code === 'KOL' ? 0 : between(0.5, 2);
      else if (featured && m.state === 'critical') cover = between(0.6, 2.2);
      else if (featured && m.state === 'low') cover = between(lead * 0.6, lead * 1.1);
      else if (m.state === 'excess') cover = between(85, 160);
      else cover = between(lead + 8, lead + 30);
      const quantity = Math.max(0, Math.round(daily * cover));
      const reorderPoint = Math.round(daily * lead * 1.3);
      levels.push({
        productId: p.id,
        warehouseId: w.id,
        quantity,
        reorderPoint,
        safetyStock: Math.round(daily * lead * 0.3),
      });
    }
  }
  await db.insert(stockLevels).values(levels);

  // ---- purchase orders across the whole lifecycle ----
  let poSeq = 1001;
  const year = now.getFullYear();
  const receipts: MovementRow[] = [];
  async function po(opts: {
    supplier: string;
    wh: string;
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RECEIVED' | 'CANCELLED';
    daysAgo: number;
    count: number;
    notes?: string;
  }) {
    const sup = supByKey.get(opts.supplier)!;
    const wh = whRows.find((w) => w.code === opts.wh)!;
    const created = new Date(now.getTime() - opts.daysAgo * DAY);
    const items = prodRows
      .filter((p) => p.supplierId === sup.id)
      .sort(() => rand() - 0.5)
      .slice(0, opts.count)
      .map((p) => ({ productId: p.id, quantity: Math.round(between(4, 12)) * 25, unitCost: p.costPrice }));
    const totalAmount = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const approved = ['APPROVED', 'RECEIVED'].includes(opts.status);
    const [row] = await db
      .insert(purchaseOrders)
      .values({
        poNumber: `PO-${year}-${String(poSeq++).padStart(5, '0')}`,
        supplierId: sup.id,
        warehouseId: wh.id,
        status: opts.status,
        notes: opts.notes ?? null,
        totalAmount,
        createdById: purchaser.id,
        approvedById: approved ? manager.id : null,
        createdAt: created,
        submittedAt: opts.status === 'DRAFT' ? null : new Date(created.getTime() + 3600_000),
        approvedAt: approved ? new Date(created.getTime() + 5 * 3600_000) : null,
        receivedAt: opts.status === 'RECEIVED' ? new Date(created.getTime() + sup.leadTimeDays * DAY) : null,
        expectedDate: new Date(created.getTime() + sup.leadTimeDays * DAY),
      })
      .returning();
    await db.insert(purchaseOrderItems).values(items.map((i) => ({ ...i, purchaseOrderId: row.id })));
    if (opts.status === 'RECEIVED') {
      for (const i of items) {
        receipts.push({
          productId: i.productId,
          warehouseId: wh.id,
          type: 'RECEIPT',
          quantity: i.quantity,
          reference: row.poNumber,
          note: 'Received against purchase order',
          userId: manager.id,
          createdAt: row.receivedAt!,
        });
      }
    }
  }
  await po({ supplier: 'grain', wh: 'KOL', status: 'RECEIVED', daysAgo: 40, count: 4 });
  await po({ supplier: 'snack', wh: 'MUM', status: 'RECEIVED', daysAgo: 33, count: 4 });
  await po({ supplier: 'care', wh: 'DEL', status: 'RECEIVED', daysAgo: 26, count: 3 });
  await po({ supplier: 'dairy', wh: 'BLR', status: 'RECEIVED', daysAgo: 12, count: 3 });
  await po({ supplier: 'bev', wh: 'KOL', status: 'RECEIVED', daysAgo: 9, count: 4 });
  await po({ supplier: 'home', wh: 'MUM', status: 'APPROVED', daysAgo: 15, count: 3, notes: 'Festive season top-up' }); // overdue
  await po({ supplier: 'spice', wh: 'DEL', status: 'APPROVED', daysAgo: 4, count: 2 });
  await po({
    supplier: 'pack',
    wh: 'BLR',
    status: 'SUBMITTED',
    daysAgo: 1,
    count: 3,
    notes: 'Please confirm dispatch date',
  });
  await po({ supplier: 'snack', wh: 'KOL', status: 'SUBMITTED', daysAgo: 0, count: 3 });
  await po({ supplier: 'care', wh: 'MUM', status: 'DRAFT', daysAgo: 0, count: 2 });
  await po({
    supplier: 'bev',
    wh: 'DEL',
    status: 'CANCELLED',
    daysAgo: 20,
    count: 2,
    notes: 'Supplier price revision',
  });
  await db.execute(sql`select setval('po_number_seq', ${poSeq - 1})`);
  console.log(`  ✓ ${poSeq - 1001} purchase orders across all statuses`);

  // ---- a little recent manual activity for the activity feed ----
  const manual: MovementRow[] = [...receipts];
  const kol = whRows.find((w) => w.code === 'KOL')!;
  const mum = whRows.find((w) => w.code === 'MUM')!;
  for (let i = 0; i < 6; i++) {
    const p = pick(prodRows);
    manual.push({
      productId: p.id,
      warehouseId: pick(whRows).id,
      type: 'ADJUSTMENT',
      quantity: -Math.round(between(1, 6)),
      note: pick(['Damaged in handling', 'Cycle count correction', 'Expired stock written off', 'Packaging torn']),
      userId: pick([manager.id, admin.id]),
      createdAt: new Date(now.getTime() - between(0.1, 6) * DAY),
    });
  }
  for (let i = 0; i < 3; i++) {
    const p = pick(prodRows);
    const qty = Math.round(between(2, 8)) * 10;
    const at = new Date(now.getTime() - between(0.2, 4) * DAY);
    const ref = `TRF-SEED${i}`;
    manual.push(
      {
        productId: p.id,
        warehouseId: mum.id,
        type: 'TRANSFER_OUT',
        quantity: -qty,
        reference: ref,
        userId: manager.id,
        createdAt: at,
      },
      {
        productId: p.id,
        warehouseId: kol.id,
        type: 'TRANSFER_IN',
        quantity: qty,
        reference: ref,
        userId: manager.id,
        createdAt: at,
      },
    );
  }
  await db.insert(stockMovements).values(manual);

  // ---- opening balances: make the ledger add up exactly to current stock ----
  // opening = current quantity − (sum of every other movement). Dated before the history starts.
  await db.execute(sql`
    insert into stock_movements (product_id, warehouse_id, type, quantity, reference, note, created_at)
    select s.product_id, s.warehouse_id, 'ADJUSTMENT', s.quantity - coalesce(m.total, 0), 'OPENING',
           'Opening balance migrated from legacy system', now() - interval '367 days'
    from stock_levels s
    left join (select product_id, warehouse_id, sum(quantity) as total from stock_movements group by 1, 2) m
      on m.product_id = s.product_id and m.warehouse_id = s.warehouse_id
    where s.quantity - coalesce(m.total, 0) <> 0`);
  console.log('  ✓ Opening balances (ledger reconciles to stock on hand)');

  // ---- forecasts: ask the FastAPI service if it's running ----
  const { runForecasts } = await import('../src/modules/forecasts/forecast.service');
  const { evaluateAlert } = await import('../src/modules/stock/stock.service');
  try {
    const r = await runForecasts();
    console.log(`  ✓ Forecasts generated for ${'count' in r ? r.count : 0} product–warehouse pairs`);
  } catch {
    console.log('  ⚠ Forecast service not reachable — start it and click "Recalculate" in the app.');
    for (const l of levels) await evaluateAlert(l.productId!, l.warehouseId!);
  }

  console.log(`\n✅ Done. Sign in with any of these (password: ${DEMO_PASSWORD}):`);
  for (const u of USERS) console.log(`   ${u.role.padEnd(9)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { closeRedis } = await import('../src/lib/redis');
    await closeRedis();
    await pool.end();
  });
