import { Tier } from '@/services/adaptiveDifficultyScaling/adaptiveDifficultyScaling';
import { fetchComponentProgress } from '@/services/firebase/progressRepo';
import { useEffect, useState } from 'react';

export function useComponentTier(userId: string | null, componentId: string) {  
    const [tier, setTier] = useState<Tier | null>(null);  
    const [loading, setLoading] = useState(true);   
    
    useEffect(() => {    
        if (!userId) return;    
        fetchComponentProgress(userId, componentId).then((progress) => {      
            setTier((progress?.currentTier as Tier) ?? 'beginner');      
            setLoading(false);    
        });  
    }, [userId, componentId]);   
    
    return { tier, loading };
}