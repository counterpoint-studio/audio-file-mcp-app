import {
    annotationDataSchema,
    type AnnotationData,
} from "../shared/annotation-data.js";
import { normalizeIncomingPath } from "./path-utils.js";

export type AnnotationInput = {
    annotations?: unknown;
    annotationsPath?: string;
};

// Precedence: inline `annotations` wins if present; else read+parse the file.
// Throws a descriptive Error on invalid JSON or schema-invalid data.
export async function resolveAnnotations(
    input: AnnotationInput,
    readFile: (p: string) => Promise<string>,
): Promise<AnnotationData | null> {
    if (input.annotations !== undefined) {
        return validate(input.annotations);
    }

    const rawPath = input.annotationsPath;
    if (rawPath === undefined) return null;

    const normalized = normalizeIncomingPath(rawPath);
    if (!normalized) {
        throw new Error("annotationsPath is empty");
    }

    const text = await readFile(normalized);
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("annotations file is not valid JSON");
    }
    return validate(parsed);
}

function validate(value: unknown): AnnotationData {
    const r = annotationDataSchema.safeParse(value);
    if (!r.success) {
        throw new Error(`invalid annotations: ${r.error.message}`);
    }
    return r.data;
}
