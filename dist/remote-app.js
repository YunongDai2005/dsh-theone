export class RemoteApp {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    /** Answer main chat's turns for the app, and receive while TheOne runs. */
    apply() {
        this.relay.apply();
        this.ctx.effect(() => {
            this.link.start();
            return async () => {
                this.cancel();
                await this.link.stop();
            };
        });
    }
    /** Stop a sign-in under way. */
    cancel() { }
    /** The settings page: status, and sign-in, pause, resume and logout. */
    async handle(request) {
        if (request.method === 'POST') {
            let row;
            try {
                row = await request.json();
            }
            catch {
                return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
            }
            switch (row?.action) {
                case 'enable':
                case 'disable':
                    await this.link.setEnabled(row.action === 'enable');
                    break;
                case 'logout':
                    this.cancel();
                    await this.link.logout();
                    break;
                default: {
                    const failed = await this.action(row ?? {});
                    if (failed)
                        return failed;
                }
            }
        }
        return Response.json(this.link.status(), { headers: { 'cache-control': 'no-store' } });
    }
}
/** A refusal the settings page can explain: `code` names it. */
export function refused(code, status = 400) {
    return Response.json({ error: code }, { status });
}
