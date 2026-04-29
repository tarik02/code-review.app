import { createContext } from "react";
import type { SuggestionEditorContextValue } from "./types";

const SuggestionEditorContext = createContext<SuggestionEditorContextValue | null>(null);

export { SuggestionEditorContext };
