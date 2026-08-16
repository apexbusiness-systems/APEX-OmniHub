import { useState, memo } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { CheckCircle2, Copy, Key, RefreshCw, Server, AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import { supabase } from '../integrations/supabase/client';
import { IntegrationDef } from '../omniconnect/core/registry'; // Use explicit path to avoid ambiguity
import { toast } from 'sonner';

interface ConnectorKitProps {
    integration: IntegrationDef;
    onConnect?: () => void;
}

// ⚡ Bolt: Wrapped ConnectorKit in React.memo() to prevent unnecessary re-renders when parent components update.
export const ConnectorKit = memo(({ integration, onConnect }: ConnectorKitProps) => {
    const [isLoading, setIsLoading] = useState(false);
    const [generatedKey, setGeneratedKey] = useState<{ key: string; prefix: string } | null>(null);
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
    const [testMessage, setTestMessage] = useState<string>('Test the connector before generating a production key.');

    const serverUrl = import.meta.env.VITE_SUPABASE_URL || 'https://api.apexomnihub.icu'; // Fallback or env
    const publicUrl = import.meta.env.VITE_PUBLIC_URL || globalThis.location.origin;

    const requireSession = async () => {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session) {
            toast.error('You must be logged in');
            return null;
        }
        return session;
    };

    const parseResponse = async (response: Response) => {
        try {
            return await response.json() as Record<string, unknown>;
        } catch {
            return {};
        }
    };

    const responseMessage = (data: Record<string, unknown>, fallback: string) => {
        const candidate = data.message ?? data.error;
        if (typeof candidate === 'string') return candidate;
        if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);
        return fallback;
    };

    const plainError = (value: unknown) => {
        const raw = typeof value === 'string' ? value : 'We could not verify this connector.';
        if (/unauthorized|auth/i.test(raw)) return 'Please sign in again, then retry the connection test.';
        if (/forbidden/i.test(raw)) return 'Your account needs admin access to connect this app. Ask an administrator to grant access.';
        if (/network|fetch|failed/i.test(raw)) return 'We could not reach the connection service. Check your internet connection, then retry.';
        if (/invalid|integration_id/i.test(raw)) return 'We could not verify that connector. Choose the app again and retry.';
        return `${raw} Check the app details, then retry.`;
    };

    const handleTestConnection = async () => {
        setTestStatus('testing');
        setTestMessage('Testing connector readiness…');
        try {
            const session = await requireSession();
            if (!session) {
                setTestStatus('failed');
                setTestMessage('Please sign in again, then retry the connection test.');
                return;
            }
            const response = await fetch(`${serverUrl}/functions/v1/omnilink-port/keys/test`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    integration_id: integration.id,
                    integration_type: integration.type,
                    name: integration.name,
                    scopes: integration.scopes ?? [],
                }),
            });
            const responseData = await parseResponse(response);
            if (!response.ok) throw new Error(responseMessage(responseData, 'Connector readiness test failed'));
            setTestStatus('passed');
            setTestMessage('Connection test passed. This app is ready for a production key.');
            toast.success('Connection test passed');
        } catch (error: unknown) {
            const message = plainError(error instanceof Error ? error.message : error);
            setTestStatus('failed');
            setTestMessage(message);
            toast.error(message);
        }
    };

    const handleGenerateKey = async () => {
        if (testStatus !== 'passed') {
            const message = 'Run Test Connection successfully before generating a production key.';
            setTestMessage(message);
            toast.error(message);
            return;
        }
        setIsLoading(true);
        try {
            // NOTE: The edge function expects the subrouting /keys.
            // We use raw fetch to be safe and precise, relying on the session.

            const session = await requireSession();
            if (!session) return;

            const response = await fetch(`${serverUrl}/functions/v1/omnilink-port/keys`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    integration_id: integration.id,
                    integration_type: integration.type,
                    name: `${integration.name} Connector`,
                    scopes: integration.scopes ?? []
                })
            });

            const responseData = await parseResponse(response);

            if (!response.ok) {
                throw new Error(responseMessage(responseData, 'Failed to generate key'));
            }

            setGeneratedKey({
                key: String(responseData.key),
                prefix: String(responseData.key_prefix),
            });

            toast.success("New API Key generated successfully");
            if (onConnect) onConnect();

        } catch (error: unknown) {
            console.error('Error generating key:', error);
            const message = plainError(error instanceof Error ? error.message : 'Failed to generate key');
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    };

    const config = {
        serverUrl,
        publicUrl,
        authorization: generatedKey ? `Bearer ${generatedKey.key}` : 'Bearer <YOUR_API_KEY>',
        integrationId: integration.id,
    };

    let testAlertClassName = '';
    if (testStatus === 'passed') testAlertClassName = 'border-emerald-500/50 bg-emerald-500/10';
    if (testStatus === 'failed') testAlertClassName = 'border-orange-500/50 bg-orange-500/10';
    const isTestPassed = testStatus === 'passed';
    const isTestRunning = testStatus === 'testing';
    const TestAlertIcon = isTestPassed ? CheckCircle2 : ShieldCheck;
    const testAlertIconClassName = isTestPassed ? 'h-4 w-4 text-emerald-500' : 'h-4 w-4';
    const TestButtonIcon = isTestRunning ? RefreshCw : ShieldCheck;
    const testButtonIconClassName = isTestRunning ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4';
    const GenerateButtonIcon = isLoading ? RefreshCw : Key;
    const generateButtonIconClassName = isLoading ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4';
    let testAlertTitle = 'Required before save';
    if (testStatus === 'passed') testAlertTitle = 'Ready to connect';
    if (testStatus === 'failed') testAlertTitle = 'Needs attention';

    const copyConfig = () => {
        navigator.clipboard.writeText(JSON.stringify(config, null, 2));
        toast.success("Configuration copied to clipboard");
    };

    const copyKey = () => {
        if (generatedKey) {
            navigator.clipboard.writeText(generatedKey.key);
            toast.success("API Key copied to clipboard");
        }
    };

    return (
        <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Server URL</Label>
                        <div className="relative">
                            <Input readOnly value={serverUrl} className="pr-10 bg-muted" />
                            <Server className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="text-xs text-muted-foreground">The endpoint for the OmniHub Edge Function.</p>
                    </div>

                    <div className="space-y-2">
                        <Label>Public URL</Label>
                        <div className="relative">
                            <Input readOnly value={publicUrl} className="pr-10 bg-muted" />
                            <ExternalLink className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="text-xs text-muted-foreground">Your publicly accessible instance URL.</p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Test Connection</Label>
                        <Alert className={testAlertClassName}>
                            <TestAlertIcon className={testAlertIconClassName} />
                            <AlertTitle>{testAlertTitle}</AlertTitle>
                            <AlertDescription>{testMessage}</AlertDescription>
                        </Alert>
                        <Button onClick={handleTestConnection} disabled={isTestRunning || isLoading} variant="outline" className="w-full">
                            <TestButtonIcon className={testButtonIconClassName} />
                            Test Connection
                        </Button>
                    </div>
                    <div className="space-y-2">
                        <Label>Authentication</Label>
                        <div className="space-y-3">
                            {generatedKey ? (
                                <div className="space-y-3">
                                    <Alert variant="destructive" className="border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-400">
                                        <AlertTriangle className="h-4 w-4 !text-orange-600 dark:!text-orange-400" />
                                        <AlertTitle>Copy this key immediately</AlertTitle>
                                        <AlertDescription>
                                            We only show this key once. If you lose it, you'll need to regenerate it.
                                        </AlertDescription>
                                    </Alert>
                                    <div className="relative group">
                                        <Input
                                            readOnly
                                            value={generatedKey.key}
                                            className="pr-24 font-mono text-sm bg-muted/50 border-orange-200 dark:border-orange-900"
                                        />
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="absolute right-1 top-1 h-7"
                                            onClick={copyKey}
                                        >
                                            <Copy className="h-4 w-4 mr-1" /> Copy
                                        </Button>
                                    </div>
                                    <Button onClick={handleGenerateKey} disabled={isLoading || testStatus !== 'passed'} variant="outline" size="sm" className="w-full text-xs h-8">
                                        <RefreshCw className="mr-2 h-3 w-3" />
                                        Regenerate (Rotates Key)
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <Button onClick={handleGenerateKey} disabled={isLoading || testStatus !== 'passed'} className="w-full">
                                        <GenerateButtonIcon className={generateButtonIconClassName} />
                                        Generate New API Key
                                    </Button>
                                    <p className="text-xs text-muted-foreground text-center">
                                        Generating a key will enable this integration.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <Card className="bg-muted/30 border-dashed">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                        <span>Quick Configuration</span>
                        <Button variant="outline" size="sm" onClick={copyConfig} disabled={!generatedKey}>
                            <Copy className="h-3 w-3 mr-2" />
                            Copy JSON
                        </Button>
                    </CardTitle>
                    <CardDescription>Use this configuration to connect your external service.</CardDescription>
                </CardHeader>
                <CardContent>
                    <pre className="text-xs bg-black/90 text-white p-4 rounded-lg overflow-x-auto font-mono">
                        {JSON.stringify(config, null, 2)}
                    </pre>
                </CardContent>
            </Card>
        </div>
    );
});
