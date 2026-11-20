// What the docks and the window layer draw on the open page (B5: "Look how overcluttered it gets"). The layout holds every
// window the user arranged on any page; a page draws only its own windows plus the shared ones (shared/pages.ts
// windowShown), so Koordinācija's matrix does not squeeze the model on Versijas, and comes back where it was on Koordinācija.
import { useMemo } from "react";
import { filterLayout, type Layout } from "../../shared/layout";
import { viewerShownOn, windowShown } from "../../shared/pages";
import { useFactReview } from "../fact-review";
import { useUi } from "../state";
import { useWindows } from "../windows";

/** Is the viewer on screen on this page: a list page and Versijas always, a full page beside an open file or a fact review. */
export function useViewerShown(): boolean {
	const { page } = useWindows();
	const { preview } = useUi();
	const reviewing = useFactReview().current !== null;
	return viewerShownOn(page, !!preview || reviewing);
}

/** The layout as this page draws it. Operations still go to the whole layout (windows.*), by window id. */
export function useShownLayout(): Layout {
	const { layout, page } = useWindows();
	const viewer = useViewerShown();
	return useMemo(() => filterLayout(layout, (id) => windowShown(id, page, viewer)), [layout, page, viewer]);
}
