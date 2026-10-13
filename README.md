# Nicotine Taper

A week-by-week plan to quit smoking gradually: switch from cigarettes to vaping without a nicotine drop, then lower the e-liquid strength step by step until you're at 0 mg.

**Live:** https://nicotine-taper.sieubadaokhanh04.workers.dev

![Nicotine Taper: plan for a 20-a-day smoker on a pod device](docs/screenshot.png)

## Features

| | |
|---|---|
| **Personal plan** | From cigarettes per day, device type and pace, it estimates your daily nicotine and suggests a starting e-liquid strength |
| **Switch phase** | Cigarettes fall week by week while vaping fills the gap, so total nicotine stays level during the switch |
| **Step-down phase** | Strength drops by a fixed percentage per step (10–20%) while the amount you vape stays the same |
| **Shop strengths & mix recipes** | Each step shows the nearest strength sold in shops and how to mix it from your starting liquid plus 0 mg liquid |
| **Today view** | Set a start date to see which step you're on, with dates for every step |
| **Chart** | Estimated nicotine per day, split into cigarettes and vaping |
| **Private** | Calculated in the browser; settings stay in local storage. "Copy link" shares a plan by URL |
| **Print** | Print-friendly layout to stick on the fridge |
| **API** | `GET /api/plan?cigsPerDay=20&device=pod&pace=steady` returns the same plan as JSON |

## How the numbers work

- A cigarette delivers about **1 mg** of nicotine to the blood (adjustable, 0.3–3 mg).
- Vaping absorption is estimated per device: pods with nicotine salt ≈ 50% of the nicotine in the liquid, refillable mouth-to-lung ≈ 40%, sub-ohm ≈ 30%.
- The starting strength is the lowest usual strength for the device at which matching your smoking stays within a comfortable daily volume (3 mL for pods, 5 mL MTL, 15 mL sub-ohm), capped at the legal maximum (20 mg/mL in the EU and UK; adjustable). If you'd need more than that, the plan warns you and suggests a stronger device or patches.
- Taper strength follows `S₀ × (1 − r)^k` until it drops below 1.5 mg/mL, then 0 mg for a couple of weeks.

All maths lives in [`public/taper.js`](public/taper.js), shared by the page, the Worker and the tests.

## Limitations

These are population estimates, **not medical advice**. Real nicotine absorption varies a lot with the device, coil, puffing style and the person. The page tells you how to adjust: signs of too much or too little nicotine, and when to stay on a step longer. Talk to a doctor or pharmacist if you're pregnant, have heart disease or take medication.

## Stack

Cloudflare Workers with static assets. Plain JavaScript, no framework and no build step. Tests use `node:test`.

## Run locally

```bash
npm install
npm test
npm run dev        # http://localhost:8787
```

## Deploy your own

```bash
npx wrangler login
npm run deploy
```

No secrets, database or bindings are needed besides static assets.
