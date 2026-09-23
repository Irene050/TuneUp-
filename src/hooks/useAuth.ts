import { auth } from '@/services/firebase/config';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useEffect, useState } from 'react';

export function useAuth() {  
    const [user, setUser] = useState<User | null>(null);  
    const [loading, setLoading] = useState(true);   
    useEffect(() => {    
        return onAuthStateChanged(auth, (u) => {      
            setUser(u);      
            setLoading(false);    
        });  
    }, []);   
    
    return {    
        loading,    
        userId: user?.uid ?? null,    
        userName: user?.displayName ?? 'Singer',    
        userEmail: user?.email ?? '',  
    };
}