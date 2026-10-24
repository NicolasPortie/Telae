import { t } from '../i18n'
import type { AuthErrorCode } from '../shared/contracts'

/** Texto para o usuário a partir do código estável devolvido pelo servidor. */
export function authErrorMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'invalid_credentials': return t('E-mail, @ ou senha errados. Confere e tenta de novo.')
    case 'email_not_verified': return t('Falta confirmar o e-mail.')
    case 'invalid_code': return t('Esse código não confere ou já venceu. Pede outro.')
    case 'weak_password': return t('Senha fraca. Usa 10 caracteres ou mais e nada óbvio.')
    case 'invalid_username': return t('O @ precisa ter de 3 a 20 caracteres: letras minúsculas, números e _.')
    case 'username_reserved': return t('Esse @ não pode ser usado.')
    case 'username_taken': return t('Esse @ já tem dono. Tenta outro.')
    case 'invalid_email': return t('Esse e-mail não parece certo.')
    case 'email_taken': return t('Já existe uma conta com esse e-mail.')
    case 'registration_closed': return t('Os cadastros estão fechados nesse servidor. Pede pra quem administra liberar seu e-mail.')
    case 'account_locked': return t('Muitas tentativas erradas. Espera uns minutos e tenta de novo.')
    case 'code_cooldown': return t('Espera um minuto antes de pedir outro código.')
    case 'rate_limited': return t('Muitos pedidos em pouco tempo. Espera um minuto e tenta de novo.')
    case 'email_unavailable': return t('Não deu pra mandar o e-mail agora. Tenta de novo daqui a pouco.')
    case 'invalid_session': return t('Sua sessão acabou. Entra de novo.')
    case 'invalid_display_name': return t('O nome precisa ter de 1 a 32 caracteres.')
    case 'network': return t('Sem conexão com o servidor. Confere sua internet.')
    default: return t('Não deu pra concluir. Tenta de novo daqui a pouco.')
  }
}
