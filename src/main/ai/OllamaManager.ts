import fetch from 'node-fetch';

export interface OllamaConfig {
    baseUrl: string;
    model: string;
    temperature?: number;
    numPredict?: number;
}

export interface OllamaModel {
    name: string;
    modified_at: string;
    size: number;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ChatResponse {
    content: string;
    model: string;
    totalDuration?: number;
    loadDuration?: number;
}

class OllamaManager {
    private config: OllamaConfig = {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:3b',
    temperature: 0.3,
    numPredict: 512
    };
  
    private isAvailableCache: boolean | null = null;
    private lastHealthCheck: number = 0;
    private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 segundos
  
  // ========== VERIFICACIÓN DE DISPONIBILIDAD ==========
  
    async checkAvailability(force: boolean = false): Promise<boolean> {
    const now = Date.now();
    
        if (!force && this.isAvailableCache !== null && (now - this.lastHealthCheck) < this.HEALTH_CHECK_INTERVAL) {
        return this.isAvailableCache;
    }
    
    try {
        const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        timeout: 5000
        });
      
        this.isAvailableCache = response.ok;
        this.lastHealthCheck = now;
        
        if (response.ok) {
        const data = await response.json();
        console.log('Ollama models available:', data.models?.map((m: any) => m.name) || []);
        }
      
        return this.isAvailableCache;
    } catch (error) {
        console.warn('Ollama is not available:', error.message);
        this.isAvailableCache = false;
        this.lastHealthCheck = now;
        return false;
    }
    }
  
  // ========== GESTIÓN DE MODELOS ==========
  
    async listModels(): Promise<OllamaModel[]> {
    try {
        const response = await fetch(`${this.config.baseUrl}/api/tags`);
        if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      
        const data = await response.json();
        return data.models || [];
    } catch (error) {
        console.error('Error listing models:', error);
        throw error;
    }
    }
  
    async pullModel(modelName: string): Promise<{ status: string, completed: boolean }> {
    try {
        const response = await fetch(`${this.config.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: false })
        });
        
        if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.statusText}`);
        }
      
        const data = await response.json();
        return { status: 'success', completed: true };
    } catch (error) {
        console.error('Error pulling model:', error);
        throw error;
    }
    }
  
  // ========== GENERACIÓN DE CHAT ==========
  
    async generateResponse(prompt: string, context?: string[]): Promise<ChatResponse> {
    const messages: ChatMessage[] = [];
    
    // Añadir contexto del RAG si existe
    if (context && context.length > 0) {
        const contextText = context
        .map((text, idx) => `[Contexto ${idx + 1}]:\n${text}`)
        .join('\n\n');
      
        messages.push({
        role: 'system',
        content: `Eres un asistente académico. Responde basándote EXCLUSIVAMENTE en el siguiente contexto. 
                    Si el contexto no contiene información relevante, di claramente:
                    "No encontré información relevante en tus documentos sobre este tema."
                    
                    CONTEXTO:
                    ${contextText}`
        });
    } else {
        messages.push({
        role: 'system',
        content: 'Eres un asistente académico útil. Responde de manera clara y concisa.'
        });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    try {
        const startTime = Date.now();
        
        const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: this.config.model,
            messages: messages,
            stream: false,
            options: {
            temperature: this.config.temperature,
            num_predict: this.config.numPredict,
            top_p: 0.9,
            repeat_penalty: 1.1
            }
        })
        });
        
        if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        const endTime = Date.now();
        
        return {
        content: data.message?.content || 'No response generated',
        model: data.model || this.config.model,
        totalDuration: endTime - startTime,
        loadDuration: data.total_duration ? data.total_duration / 1000000 : undefined
        };
        
    } catch (error) {
        console.error('Error generating response:', error);
        
      // Respuesta de fallback en caso de error
        return {
        content: `Lo siento, hubo un error al procesar tu pregunta. Asegúrate de que Ollama está corriendo (http://localhost:11434). Error: ${error.message}`,
        model: 'error',
        totalDuration: 0
        };
    }
    }
    
  // ========== GENERACIÓN DE CONTENIDO ==========
    
    async generateContent(systemPrompt: string, userContent: string): Promise<string> {
    const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
    ];
    
    try {
        const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: this.config.model,
            messages: messages,
            stream: false,
            options: {
            temperature: 0.7,
            num_predict: 1024
            }
        })
        );
        const data = await response.json();
        return data.message?.content || '';
    } catch (error) {
        console.error('Error generating content:', error);
        throw error;
    }
    }
  
  // ========== GENERACIÓN DE PODCAST ==========
  
    async generatePodcastScript(topic: string, keyPoints: string[], duration: number = 10): Promise<string> {
    const systemPrompt = `Eres un creador de podcasts educativos. Crea un guion para un podcast de ${duration} minutos.
                         Estructura:
                            1. Introducción atractiva (30 segundos)
                            2. Desarrollo de ${keyPoints.length} puntos principales
                            3. Ejemplo práctico
                            4. Conclusión y resumen
                            5. Despedida
                            
                            Usa un tono conversacional y amigable. Incluye transiciones naturales.`;
    
    const userContent = `Tema: ${topic}
                        Puntos clave: ${keyPoints.join(', ')}
                        Duración objetivo: ${duration} minutos`;
    
    return this.generateContent(systemPrompt, userContent);
    }
  
  // ========== GENERACIÓN DE PREGUNTAS ==========
  
    async generateQuestions(context: string, numQuestions: number = 5): Promise<string[]> {
    const systemPrompt = `Genera ${numQuestions} preguntas de evaluación basadas en el siguiente texto.
                         Las preguntas deben:
                            1. Cubrir diferentes aspectos del contenido
                            2. Tener distintos niveles de dificultad
                            3. Ser claras y concisas
                            4. Incluir la respuesta correcta (al final, separada)
                            
                            Formato: Cada pregunta en una línea nueva, con las respuestas al final.`;
        
    const result = await this.generateContent(systemPrompt, context);
    
    // Parsear resultado
    const lines = result.split('\n').filter(line => line.trim());
    return lines;
    }
    
  // ========== CONFIGURACIÓN ==========
    
    setConfig(newConfig: Partial<OllamaConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('Ollama config updated:', this.config);
    }
    
    getConfig(): OllamaConfig {
    return { ...this.config };
    }
    
    setModel(modelName: string): void {
    this.config.model = modelName;
    console.log('Ollama model set to:', modelName);
    }
    
    getModel(): string {
    return this.config.model;
    }
}

export default new OllamaManager();