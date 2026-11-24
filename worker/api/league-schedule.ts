import type { WeeklyLeagueSchedule } from "./app-config";

const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export type LeagueScheduleState = {
  timezone: "Africa/Lagos";
  is_open: boolean;
  current_open_at: string | null;
  current_close_at: string | null;
  next_open_at: string | null;
  next_close_at: string | null;
};

function parseLocalTime(value: string): { hours: number; minutes: number } {
  const [hours, minutes] = value.split(":").map(Number);
  return { hours, minutes };
}

function localDateStart(now: Date): Date {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

function localDateAt(dateStart: Date, weekday: number, time: string): Date {
  const currentWeekday = dateStart.getUTCDay();
  const daysFromStartOfWeek = (weekday - currentWeekday + 7) % 7;
  const localDate = new Date(dateStart.getTime() + daysFromStartOfWeek * 24 * 60 * 60 * 1000);
  const { hours, minutes } = parseLocalTime(time);
  return new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    hours,
    minutes,
  ) - LAGOS_OFFSET_MS);
}

export function resolveLeagueSchedule(schedule: WeeklyLeagueSchedule, nowMs = Date.now()): LeagueScheduleState {
  const now = new Date(nowMs);
  const firstOpen = new Date(schedule.first_open_at);
  const firstOpenLocal = new Date(firstOpen.getTime() + LAGOS_OFFSET_MS);
  const closeDays = (schedule.close_weekday - schedule.open_weekday + 7) % 7;
  const firstClose = new Date(firstOpen.getTime() + closeDays * 24 * 60 * 60 * 1000);
  const firstCloseLocal = new Date(firstClose.getTime() + LAGOS_OFFSET_MS);
  const { hours: closeHours, minutes: closeMinutes } = parseLocalTime(schedule.close_time_local);
  const firstCloseAt = new Date(Date.UTC(
    firstCloseLocal.getUTCFullYear(),
    firstCloseLocal.getUTCMonth(),
    firstCloseLocal.getUTCDate(),
    closeHours,
    closeMinutes,
  ) - LAGOS_OFFSET_MS);

  if (now < firstOpen) {
    return {
      timezone: schedule.timezone,
      is_open: false,
      current_open_at: null,
      current_close_at: null,
      next_open_at: firstOpen.toISOString(),
      next_close_at: firstCloseAt.toISOString(),
    };
  }

  const todayStart = localDateStart(now);
  const thisWeekOpen = localDateAt(todayStart, schedule.open_weekday, schedule.open_time_local);
  let openAt = thisWeekOpen;
  if (openAt.getTime() > nowMs) openAt = new Date(openAt.getTime() - 7 * 24 * 60 * 60 * 1000);

  const openLocal = new Date(openAt.getTime() + LAGOS_OFFSET_MS);
  const closeLocalDate = new Date(openLocal.getTime() + closeDays * 24 * 60 * 60 * 1000);
  const { hours: closeAtHours, minutes: closeAtMinutes } = parseLocalTime(schedule.close_time_local);
  const closeAt = new Date(Date.UTC(
    closeLocalDate.getUTCFullYear(),
    closeLocalDate.getUTCMonth(),
    closeLocalDate.getUTCDate(),
    closeAtHours,
    closeAtMinutes,
  ) - LAGOS_OFFSET_MS);

  if (now >= openAt && now < closeAt) {
    return {
      timezone: schedule.timezone,
      is_open: true,
      current_open_at: openAt.toISOString(),
      current_close_at: closeAt.toISOString(),
      next_open_at: openAt.toISOString(),
      next_close_at: closeAt.toISOString(),
    };
  }

  const nextOpen = new Date(openAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextOpenLocal = new Date(nextOpen.getTime() + LAGOS_OFFSET_MS);
  const nextCloseLocal = new Date(nextOpenLocal.getTime() + closeDays * 24 * 60 * 60 * 1000);
  const nextCloseAt = new Date(Date.UTC(
    nextCloseLocal.getUTCFullYear(),
    nextCloseLocal.getUTCMonth(),
    nextCloseLocal.getUTCDate(),
    closeAtHours,
    closeAtMinutes,
  ) - LAGOS_OFFSET_MS);

  return {
    timezone: schedule.timezone,
    is_open: false,
    current_open_at: null,
    current_close_at: null,
    next_open_at: nextOpen.toISOString(),
    next_close_at: nextCloseAt.toISOString(),
  };
}
