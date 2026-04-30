import { Link } from "react-router-dom";
import { TbFaceId } from "react-icons/tb";
import { MdCategory } from "react-icons/md";
import { LuBrainCircuit } from "react-icons/lu";

export default function TrainingCenter() {
    return (
        <div className="flex size-full flex-col p-6 bg-background">
            <div className="flex h-14 items-center justify-between border-b border-secondary-highlight mb-6">
                <h1 className="text-2xl font-bold tracking-tight">Central de Treinamento IA</h1>
            </div>

            <div className="max-w-5xl mx-auto w-full mt-4 space-y-6">
                <div className="rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm flex items-start gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-lg">
                        <LuBrainCircuit className="h-8 w-8 text-blue-500" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-primary">Estúdio de Customização de Modelos</h2>
                        <p className="text-muted-foreground text-sm mt-1">
                            Personalize o funcionamento da Inteligência Artificial do IA Cloud Vision ensinando explicitamente
                            o que observar. O sistema retreinará modelos locais otimizados sem necessidade de acesso à internet externa.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                    <Link
                        to="/faces"
                        className="group flex flex-col rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm hover:border-primary transition duration-200"
                    >
                        <div className="flex items-center justify-between pb-4 border-b border-secondary-highlight/50">
                            <h3 className="text-lg font-semibold text-primary group-hover:text-blue-400 transition-colors">Reconhecimento Facial</h3>
                            <div className="p-2 bg-secondary rounded-lg group-hover:bg-blue-500/10 transition-colors">
                                <TbFaceId className="h-6 w-6 text-muted-foreground group-hover:text-blue-500 transition-colors" />
                            </div>
                        </div>
                        <div className="mt-4 flex-1">
                            <p className="text-sm text-muted-foreground">
                                Cadastre faces previamente autorizadas e crie nomes ou identidades. A IA passará a classificar e alertar sobre
                                essas pessoas especificamente, reduzindo falsos positivos ou viabilizando controle de acesso.
                            </p>
                        </div>
                        <div className="mt-6 font-medium text-blue-500 flex justify-end items-center text-sm">
                            Acessar Biblioteca Facial &rarr;
                        </div>
                    </Link>

                    <Link
                        to="/classification"
                        className="group flex flex-col rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm hover:border-primary transition duration-200"
                    >
                        <div className="flex items-center justify-between pb-4 border-b border-secondary-highlight/50">
                            <h3 className="text-lg font-semibold text-primary group-hover:text-orange-400 transition-colors">Classificação de Objetos e Estados</h3>
                            <div className="p-2 bg-secondary rounded-lg group-hover:bg-orange-500/10 transition-colors">
                                <MdCategory className="h-6 w-6 text-muted-foreground group-hover:text-orange-500 transition-colors" />
                            </div>
                        </div>
                        <div className="mt-4 flex-1">
                            <p className="text-sm text-muted-foreground">
                                Treine classificadores genéricos ou de estados (ex: porta aberta/fechada, vaga ocupada) fornecendo
                                exemplos positivos e negativos capturados pelo próprio IA Cloud Vision.
                            </p>
                        </div>
                        <div className="mt-6 font-medium text-orange-500 flex justify-end items-center text-sm">
                            Acessar Modelos Opcionais &rarr;
                        </div>
                    </Link>
                </div>
            </div>
        </div>
    );
}
