/*
 * The wake-up alarm of the MCU holds month, day, hour and minute – no year.
 * alarm_when() gives the moment such an alarm stands for: the year of "now",
 * or the next one when that would lie more than half a year back (an alarm
 * for 1 January, read or set on 31 December).
 *
 * utc != 0: the fields are UTC (as the MCU keeps them), otherwise local time
 * (as the user gives them). Fields out of range are carried over, as
 * mktime() does. Returns (time_t)-1 on error.
 */
#ifndef MCU_ALARM_H
#define MCU_ALARM_H

#include <time.h>

#define ALARM_PAST (183L * 24 * 3600)

static time_t alarm_when(time_t now, int month, int day, int hour, int min, int utc) {
	struct tm *n = utc ? gmtime(&now) : localtime(&now);
	int i, year;
	time_t t = (time_t)-1;

	if (n == NULL)
		return (time_t)-1;
	year = n->tm_year;

	for (i = 0; i < 2; i++) {
		struct tm tm = {0};
		tm.tm_min = min;
		tm.tm_hour = hour;
		tm.tm_mday = day;
		tm.tm_mon = month - 1;
		tm.tm_year = year + i;
		tm.tm_isdst = -1;
		t = utc ? timegm(&tm) : mktime(&tm);
		if (t == (time_t)-1 || t >= now - ALARM_PAST)
			break;
	}
	return t;
}

#endif
