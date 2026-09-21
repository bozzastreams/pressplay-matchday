export type ScheduleEntry = {
  id: string;
  name: string;
  q13: number[];
  q24: number[];
};

const parseCsvRow = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current.trim());
  return values;
};

const parseScheduleBits = (value: string | number[] | undefined): number[] => {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item));
  }

  const normalized = String(value ?? '').trim();
  if (!normalized) return [];

  return normalized
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));
};

export const parseScheduleCsv = (csvText: string): ScheduleEntry[] => {
  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length < 2) return KAMPONG_BLOE_SCHEDULE;

  const headers = parseCsvRow(rows[0]).map((header) => header.toLowerCase());
  const idIndex = headers.indexOf('id');
  const nameIndex = headers.indexOf('name');
  const q13Index = headers.indexOf('q13');
  const q24Index = headers.indexOf('q24');

  if (idIndex === -1 || nameIndex === -1 || q13Index === -1 || q24Index === -1) {
    return KAMPONG_BLOE_SCHEDULE;
  }

  const parsed = rows.slice(1)
    .map((row) => parseCsvRow(row))
    .map((values) => {
      const id = (values[idIndex] ?? '').trim();
      const name = (values[nameIndex] ?? '').trim();
      const q13 = parseScheduleBits(values[q13Index]);
      const q24 = parseScheduleBits(values[q24Index]);

      if (!id || !name) return null;

      return {
        id: id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name,
        q13,
        q24,
      } satisfies ScheduleEntry;
    })
    .filter((entry): entry is ScheduleEntry => Boolean(entry));

  const uniqueIds = new Set(parsed.map((entry) => entry.id)).size === parsed.length;
  const validMinutes = parsed.every((entry) =>
    entry.q13.length === 15 && entry.q24.length === 15 &&
    [...entry.q13, ...entry.q24].every((value) => value === 0 || value === 1));
  const elevenOn = [0, 1].every((quarterPattern) =>
    Array.from({ length: 15 }, (_, minute) =>
      parsed.reduce((count, entry) => count + (quarterPattern === 0 ? entry.q13[minute] : entry.q24[minute]), 0))
      .every((count) => count === 11));

  return parsed.length >= 11 && uniqueIds && validMinutes && elevenOn ? parsed : KAMPONG_BLOE_SCHEDULE;
};

export const loadScheduleFromCsv = async (source = `${import.meta.env.BASE_URL}schedule.csv`): Promise<ScheduleEntry[]> => {
  try {
    const response = await fetch(source);
    if (!response.ok) return KAMPONG_BLOE_SCHEDULE;

    const csvText = await response.text();
    const parsed = parseScheduleCsv(csvText);
    return parsed.length > 0 ? parsed : KAMPONG_BLOE_SCHEDULE;
  } catch {
    return KAMPONG_BLOE_SCHEDULE;
  }
};

export const KAMPONG_BLOE_SCHEDULE: ScheduleEntry[] = [
  { id: 'babette', name: 'Babette', q13: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], q24: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] },
  { id: 'faat', name: 'Faat', q13: [1,1,1,1,1,1,1,1,1,1,1,1,1,0,0], q24: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] },
  { id: 'char', name: 'Char', q13: [0,0,0,1,1,1,1,1,0,0,1,1,1,1,1], q24: [0,0,0,1,1,1,1,0,0,1,1,1,1,1,1] },
  { id: 'mikki', name: 'Mikki', q13: [1,1,1,1,1,1,1,1,1,1,0,0,0,1,1], q24: [1,1,1,1,1,1,1,1,1,0,0,1,1,1,1] },
  { id: 'tukkie', name: 'Tukkie', q13: [1,1,1,0,0,1,1,1,1,1,1,1,1,1,1], q24: [1,1,1,0,0,1,1,1,1,1,1,1,1,1,1] },
  { id: 'muis', name: 'Muis', q13: [1,1,1,1,1,0,0,0,1,1,1,1,1,1,1], q24: [1,1,1,1,1,0,0,1,1,1,1,0,0,0,0] },
  { id: 'wolf', name: 'Wolf', q13: [1,1,1,1,0,0,0,1,1,1,1,1,1,0,0], q24: [1,1,1,0,0,1,1,1,1,0,0,1,1,1,1] },
  { id: 'lilly', name: 'Lilly', q13: [0,0,0,1,1,1,1,0,0,0,1,1,1,1,1], q24: [0,0,0,1,1,1,1,0,0,1,1,1,1,0,0] },
  { id: 'mo', name: 'Mo', q13: [1,1,1,0,0,1,1,1,1,1,0,0,0,1,1], q24: [1,1,1,1,0,0,0,1,1,1,1,1,0,0,0] },
  { id: 'eline', name: 'Eline', q13: [1,1,1,1,1,0,0,1,1,1,1,0,0,1,1], q24: [1,1,1,1,1,0,0,1,1,1,1,0,0,1,1] },
  { id: 'lynn', name: 'Lynn', q13: [0,0,0,0,1,1,1,0,0,0,0,1,1,0,0], q24: [0,0,0,0,1,1,1,0,0,0,0,0,1,1,1] },
  { id: 'bente', name: 'Bente', q13: [1,1,1,0,0,1,1,1,1,0,0,1,1,1,1], q24: [1,1,1,0,0,1,1,1,1,0,0,1,1,1,1] },
  { id: 'sos', name: 'Sos', q13: [1,1,1,1,0,0,1,1,1,1,1,0,0,1,1], q24: [1,1,1,1,0,0,1,1,1,1,1,0,0,1,1] },
  { id: 'ier', name: 'Ier', q13: [1,1,1,1,1,0,0,0,1,1,1,1,0,0,0], q24: [1,1,1,1,1,0,0,0,1,1,1,1,0,0,0] },
  { id: 'mea', name: 'Mea', q13: [0,0,0,1,1,1,0,0,0,1,1,1,1,0,0], q24: [0,0,0,1,1,1,0,0,0,1,1,1,1,0,0] },
  { id: 'maud-leo', name: 'Maud/ Leo', q13: [0,0,0,0,1,1,1,1,0,0,0,0,1,1,1], q24: [0,0,0,0,1,1,1,1,0,0,0,0,1,1,1] },
];
