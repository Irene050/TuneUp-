import { Tier } from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';
import { ComponentId } from '@/services/assessment/assessmentModule';

export interface ExerciseRecord {  
    componentId: ComponentId;  
    templateId: string;  
    tier: Tier;  
    scorePct: number;  
    timestamp: number;
} 

export interface ComponentProgressSummary {  
    componentId: ComponentId;  
    currentTier: Tier;  
    exercisesCompleted: number;  
    averageRecentScorePct: number;
} 

export function summarizeProgress(  
    records: ExerciseRecord[],  
    currentTiers: Record<ComponentId, Tier>
): ComponentProgressSummary[] {  
    const componentIds: ComponentId[] = ['breathControl', 'pitch', 'tone', 'volume', 'agility'];   
    
    return componentIds.map((componentId) => {    
        const componentRecords = records.filter((r) => r.componentId === componentId);    
        const recentFive = componentRecords.slice(-5);    
        const averageRecentScorePct = recentFive.length      
        ? recentFive.reduce((sum, r) => sum + r.scorePct, 0) / recentFive.length      
        : 0;     
        
        return {      
            componentId,      
            currentTier: currentTiers[componentId],      
            exercisesCompleted: componentRecords.length,      
            averageRecentScorePct: Math.round(averageRecentScorePct),    
        };  
    });
}