export interface ParameterBounds {  
    min: number;  
    max: number;
} 

export type Tier = 'beginner' | 'intermediate' | 'advanced'; 

/** Step 0 — fixed, never affected by scoring bias. */
export const TIER_PROGRESSION_REQUIREMENTS = {  
    beginnerToIntermediate: {    
        minExercises: 20,    
        minAccuracyPct: 75,    
        minTemplatesCovered: 4,    
        minPerTemplate: 3,  
    },  
    intermediateToAdvanced: {    
        minExercises: 30,    
        minAccuracyPct: 90,    
        minTemplatesCovered: 5,    
        minPerTemplate: 4,  
    },
};

/** Step 1 — determine the reference value. */

export function getReferenceValue(  
    recentScores: number[],  
    assessmentScoreForComponent: number
): number {  
    if (recentScores.length === 0) {   
        // Cold start: no exercise history yet in this tier, so seed from the    
        // user's Assessment result for this component instead.    
        return assessmentScoreForComponent;  
    }  
    const lastFive = recentScores.slice(-5);  
    return lastFive.reduce((a, b) => a + b, 0) / lastFive.length;
} 

/** Step 2 — bias the tier's base parameter bounds using the reference value. */
export function biasParameterBounds(  
    baseBounds: ParameterBounds,  
    referenceValue: number,  
    tierBaselinePct = 67 // midpoint of the 60-74% "tier baseline" band
): ParameterBounds {  
    const range = baseBounds.max - baseBounds.min;  
    const deviation = (referenceValue - tierBaselinePct) / 100; // -1..1 roughly   
    
    // Positive deviation (above baseline) shifts the working range toward the harder end; 
    // negative deviation shifts it toward the easier end.  
    // "Harder" is context-dependent (sometimes larger numbers are harder,  like duration; 
    // sometimes smaller numbers are harder, like tolerance —  callers pass baseBounds already oriented so max = hardest).  

    const shiftAmount = range * deviation * 0.5;   
    const biasedMin = clamp(baseBounds.min + shiftAmount, baseBounds.min, baseBounds.max);  
    const biasedMax = clamp(baseBounds.max + shiftAmount, baseBounds.min, baseBounds.max);   
    return { min: Math.min(biasedMin, biasedMax), max: Math.max(biasedMin, biasedMax) };}

function clamp(value: number, min: number, max: number): number {  
    return Math.max(min, Math.min(max, value));} 
    /** 
    * Full pipeline: given a component's recent scores (or its assessment score as a fallback) 
    * and its tier's base bounds, return the Adjusted Parameter * Bounds that the Exercise 
    * Session Manager should generate from. 
    */
   
export function calculateAdjustedParameterBounds(  
    recentScores: number[],  
    assessmentScoreForComponent: number,  
    baseBounds: ParameterBounds): ParameterBounds {  
        const referenceValue = getReferenceValue(recentScores, assessmentScoreForComponent);  
        
        return biasParameterBounds(baseBounds, referenceValue);} /** Checks whether a component qualifies to unlock the next tier. Independent of scoring bias. */
        
export function checkTierProgression(  
    currentTier: Tier,  
    exerciseHistory: { templateId: string; scorePct: number }[]
): { canUnlock: boolean; nextTier: Tier | null } {  
        if (currentTier === 'advanced') return { canUnlock: false, nextTier: null };   
        
        const requirements =    
        currentTier === 'beginner'      
        ? TIER_PROGRESSION_REQUIREMENTS.beginnerToIntermediate      
        : TIER_PROGRESSION_REQUIREMENTS.intermediateToAdvanced;   
        
        const qualifying = exerciseHistory.filter((e) => e.scorePct >= requirements.minAccuracyPct);  
        const templatesCovered = new Set(qualifying.map((e) => e.templateId));  
        const perTemplateCounts = new Map<string, number>();  
        
        for (const e of qualifying) {    
            perTemplateCounts.set(e.templateId, (perTemplateCounts.get(e.templateId) ?? 0) + 1);  
        }  
        
        const templatesWithMinimum = [...perTemplateCounts.values()].filter(    
            (count) => count >= requirements.minPerTemplate  
        ).length;   
        
        const canUnlock =    
        qualifying.length >= requirements.minExercises &&    
        templatesCovered.size >= requirements.minTemplatesCovered &&    
        templatesWithMinimum >= requirements.minTemplatesCovered;   
        
        return {    
            canUnlock,    
            nextTier: canUnlock ? (currentTier === 'beginner' ? 'intermediate' : 'advanced') : null,  
        };
    }