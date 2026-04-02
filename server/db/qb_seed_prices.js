// Seeds the QB price list with items from the Excel Pricing sheet
// Run: node server/db/qb_seed_prices.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     process.env.DB_PORT     || 5432,
      database: process.env.DB_NAME     || 'space_tech_design',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
    });

const MATERIALS = [
  { product: '16mm HMR White',              price: 40,    unit: 'sheet' },
  { product: '16mm HMR Black',              price: 71,    unit: 'sheet' },
  { product: '25mm HMR White',              price: 88,    unit: 'sheet' },
  { product: 'Polytec 162412 Matt',         price: 75,    unit: 'sheet' },
  { product: 'Polytec 162412 WM&Sm',        price: 155,   unit: 'sheet' },
  { product: 'Polytec Lam 3600 x 1360',     price: 275,   unit: 'sheet' },
  { product: 'Polytec 162412 SS Venette',   price: 280,   unit: 'sheet' },
  { product: 'Polytec 162412 DS Legato',    price: 200,   unit: 'sheet' },
  { product: 'Laminex Lam',                 price: 80,    unit: 'm2'    },
  { product: '182412 White Satin',          price: 53,    unit: 'sheet' },
  { product: '183112 White Satin',          price: 68,    unit: 'sheet' },
  { product: '182412 White Satin LMG',      price: 60,    unit: 'sheet' },
  { product: '22x1 ABS',                    price: 0.5,   unit: 'm2'    },
  { product: '22x1 ABS Colour',             price: 2,     unit: 'm2'    },
  { product: '25 & 38x1 ABS Colour',        price: 3,     unit: 'm2'    },
  { product: '6mm STD MDF',                 price: 7.75,  unit: 'm2'    },
  { product: '9mm STD MDF',                 price: 11.75, unit: 'm2'    },
  { product: '12mm STD MDF',                price: 12.5,  unit: 'm2'    },
  { product: '16mm STD MDF',                price: 15,    unit: 'm2'    },
  { product: '18mm STD MDF',                price: 18.5,  unit: 'm2'    },
  { product: '25mm STD MDF',                price: 29.75, unit: 'm2'    },
  { product: '9mm MR MDF',                  price: 13.75, unit: 'm2'    },
  { product: '12mm MR MDF',                 price: 15.5,  unit: 'm2'    },
  { product: '16mm MR MDF',                 price: 18.75, unit: 'm2'    },
  { product: '18mm MR MDF',                 price: 22.5,  unit: 'm2'    },
  { product: '25mm MR MDF',                 price: 35.5,  unit: 'm2'    },
  { product: 'Polish / Paint',              price: 25,    unit: 'ltr'   },
  { product: 'General Ally Angle',          price: 5,     unit: 'l/m'   },
  { product: 'Postforming',                 price: 230,   unit: 'l/m'   },
  { product: 'Vent',                        price: 25,    unit: 'each'  },
  { product: 'Bendy Ply 5mm',              price: 60,    unit: 'sheet' },
];

const HARDWARE = [
  { product: 'Handle',                      price: 15,    unit: 'each'  },
  { product: 'Tip On Push to Open',         price: 5,     unit: 'each'  },
  { product: 'Metabox Non-softclose',       price: 15,    unit: 'each'  },
  { product: 'Std Finista',                 price: 32,    unit: 'pair'  },
  { product: 'Gallery Finista',             price: 36,    unit: 'pair'  },
  { product: 'Pot Finista',                 price: 51,    unit: 'pair'  },
  { product: '110 Degree Hinges',           price: 12,    unit: 'each'  },
  { product: '170 & Cnr Hinges',            price: 20,    unit: 'each'  },
  { product: 'Locks',                       price: 10,    unit: 'each'  },
  { product: 'File Drawer Set',             price: 28,    unit: 'each'  },
  { product: 'Sauth Vagel Bin w Inner',     price: 450,   unit: 'each'  },
  { product: 'Cutlery Tray',               price: 15,    unit: 'each'  },
  { product: 'KD & Rafix',                 price: 0.40,  unit: 'each'  },
  { product: 'Hang Rod & Rail',            price: 8,     unit: 'each'  },
  { product: 'LDF 2700x1200x39',           price: 250,   unit: 'sheet' },
  { product: 'Am Oak G2S',                 price: 250,   unit: 'sheet' },
  { product: 'Freight Charge',             price: 45,    unit: 'each'  },
  { product: 'Sundry Expenses',            price: 30,    unit: 'each'  },
];

async function seedCategory(category, items) {
  const { rows: existing } = await pool.query(
    'SELECT COUNT(*) FROM qb_price_list WHERE category = $1', [category]
  );
  if (parseInt(existing[0].count) > 0) {
    console.log(`${category}: already has data — skipping.`);
    return;
  }
  console.log(`Seeding ${category}...`);
  for (let i = 0; i < items.length; i++) {
    const { product, price, unit } = items[i];
    await pool.query(
      `INSERT INTO qb_price_list (category, product, price, unit, sort_order) VALUES ($1,$2,$3,$4,$5)`,
      [category, product, price, unit, i]
    );
  }
  console.log(`Seeded ${items.length} ${category} items.`);
}

async function seed() {
  await seedCategory('Materials', MATERIALS);
  await seedCategory('Hardware', HARDWARE);
  await pool.end();
}

seed().catch(err => { console.error(err); process.exit(1); });
