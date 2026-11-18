const enabled = process.env.EXPO_PUBLIC_MEASURE_LIST === "1";
let tabPressedAt: number | null = null;
let reported = false;

export function measureTaskTab() {
  if (enabled && !reported && tabPressedAt === null)
    tabPressedAt = performance.now();
}

export function measureFirstTaskLayout() {
  if (tabPressedAt === null || reported) return;
  reported = true;
  console.info(
    `COSPACE_TASK_LIST_READY ${(performance.now() - tabPressedAt).toFixed(2)}`,
  );
}
