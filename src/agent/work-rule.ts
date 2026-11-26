// The rule that keeps an agent working: the model's own habit is to end its message with a list of next steps and wait for the user to say "go".
// The user ruled (2026-11-26) that agents work until the task is done and stop only for a real blocker. Since 2.15.1 a change on the working copy
// asks for no click, so nothing but a real blocker is a reason to stop. One text for the lead (prompt.ts) and for specialists (subagents.ts RULES).

/** The lead's rule 11 and a specialist's closing rule: work to the end, stop only for a blocker. */
export const WORK_RULE =
	"Strādā līdz uzdevums ir pabeigts. Izpildi visus plāna soļus pēc kārtas, katru ar savu izsaukumu; neapstājies, lai prasītu «go», «turpināt» vai apstiprinājumu, un neizbeidz atbildi ar nākamo soļu sarakstu — veic tos pats. «Viens izsaukums — viena darbība» ir izsaukuma lielums, nevis pauze: pēc katra izsaukuma ej tālāk, nevis gaidi lietotāju. Apstājies tikai pie īsta šķēršļa: trūkst datu, ko nevar iegūt ar rīkiem; rīks atsakās; vai lēmums pieder lietotājam. Tad pasaki, kas ir izdarīts un kas tieši vajadzīgs. Pabeidzot — īss kopsavilkums.";
