import { fetchAllProgress } from '@/services/firebase/progressRepo';
import { ComponentProgressSummary } from '@/services/progress/progressModule';
import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export function useProgress() {  
    const { userId } = useAuth();  
    const [summaries, setSummaries] = useState<ComponentProgressSummary[]>([]);  
    const [loading, setLoading] = useState(true);   
    
    useEffect(() => {    
        if (!userId) return;    
        fetchAllProgress(userId).then((data) => {      
            setSummaries(data);      
            setLoading(false);    
        });  
    }, [userId]);   
    
    return { summaries, loading };
}