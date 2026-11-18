// «BB Automation» helper: a tiny AppleScript applet that runs one script per
// launch and writes the result next to the request. macOS then asks
// «"BB Automation" wants to control "<App>"» instead of naming the BB host
// process ("node"). The applet is built once per source version with
// osacompile, marked as a background app and ad-hoc signed, so the user's
// Automation choices stay attached to it.

export const APPLET_NAME = 'BB Automation';
export const APPLET_BUNDLE_ID = 'app.bb.mac-computer-use.automation';
export const APPLET_VERSION = '1';

export const APPLET_SOURCE = String.raw`use AppleScript version "2.4"
use framework "Foundation"
use scripting additions

on run
	set argv to (current application's NSProcessInfo's processInfo()'s arguments()) as list
	set reqPath to item -1 of argv
	set outPath to reqPath & ".out"
	set reply to ""
	try
		set src to (current application's NSString's stringWithContentsOfFile:reqPath encoding:4 |error|:(missing value))
		if src is missing value then error "request not found"
		set res to run script (src as text)
		try
			set reply to "OK" & linefeed & (res as text)
		on error
			set reply to "OK" & linefeed & "(result is not text)"
		end try
	on error errMsg number errNum
		set reply to "ERR " & errNum & linefeed & errMsg
	end try
	set outStr to current application's NSString's stringWithString:reply
	outStr's writeToFile:outPath atomically:true encoding:4 |error|:(missing value)
	quit
end run
`;

/** Application names a script addresses with `tell application "…"` / `application id "…"`. */
export function scriptTargets(script: string): string[] {
  const out = new Set<string>();
  for (const m of script.matchAll(/\b(?:tell\s+)?application\s+(?:id\s+)?"([^"]{1,200})"/gi)) out.add(m[1]!);
  for (const m of script.matchAll(/\bApplication\(\s*['"]([^'"]{1,200})['"]\s*\)/g)) out.add(m[1]!);
  return [...out];
}
