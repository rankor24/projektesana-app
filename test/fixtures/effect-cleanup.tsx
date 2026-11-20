// Read as text by test/12.5-effect-cleanup.test.ts; never compiled or run.
// @ts-nocheck
function Feed() {
	useEffect(() => endRef.current?.scrollIntoView?.({ block: "end" }), [lines]);
	useEffect(() => {
		if (!projectId) return setRow(null);
	}, [projectId]);
	useEffect(() => on("room.line", () => undefined), []);
	useEffect(() => { const off = on("x", f); return off; }, []);
	useEffect(load, []);
	useEffect(() => { el.scrollIntoView(); }, []);
}
