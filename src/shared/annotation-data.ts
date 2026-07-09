import * as z from "zod";

export const annotationSpanSchema = z.object({
    start: z.number().min(0).finite(),
    end: z.number().min(0).finite(),
});

export const annotationEnvelopePointSchema = z.object({
    time: z.number().min(0).finite(),
    value: z.number().min(0).max(1).finite(),
});

export const annotationLaneSchema = z.object({
    label: z.string().optional(),
    color: z.string().optional(), // CSS color; validated leniently, sanitized at render
    spans: z.array(annotationSpanSchema),
    envelope: z.array(annotationEnvelopePointSchema).optional(),
});

export const annotationDataSchema = z.object({
    lanes: z.array(annotationLaneSchema),
});

export type AnnotationSpan = z.infer<typeof annotationSpanSchema>;
export type AnnotationEnvelopePoint = z.infer<
    typeof annotationEnvelopePointSchema
>;
export type AnnotationLane = z.infer<typeof annotationLaneSchema>;
export type AnnotationData = z.infer<typeof annotationDataSchema>;

export function parseAnnotationData(value: unknown): AnnotationData | null {
    const r = annotationDataSchema.safeParse(value);
    return r.success ? r.data : null;
}
